"""Canonical dashboard runtime service."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from thoth.observe.read_model import load_config

DEFAULT_DASHBOARD_PORT = 8501
DASHBOARD_PORT_SCAN_LIMIT = 100


def _manifest(project_root: Path) -> dict[str, Any]:
    return load_config(project_root)


def _python_bin(project_root: Path) -> str:
    runtime = _manifest(project_root).get("runtime", {})
    if isinstance(runtime, dict):
        value = runtime.get("python_bin")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "python"


def dashboard_port(project_root: Path) -> int:
    dashboard = _manifest(project_root).get("dashboard", {})
    if isinstance(dashboard, dict):
        value = dashboard.get("port")
        if isinstance(value, int):
            return value
    return DEFAULT_DASHBOARD_PORT


def _pid_file(project_root: Path) -> Path:
    return project_root / ".thoth" / "derived" / "dashboard.pid"


def _log_file(project_root: Path) -> Path:
    return project_root / ".thoth" / "derived" / "dashboard.log"


def _status_file(project_root: Path) -> Path:
    return project_root / ".thoth" / "derived" / "dashboard.status.json"


def _port_file(project_root: Path) -> Path:
    return project_root / ".thoth" / "derived" / "dashboard.port"


def _backend_dir(project_root: Path) -> Path:
    return project_root / "tools" / "dashboard" / "backend"


def _frontend_dir(project_root: Path) -> Path:
    return project_root / "tools" / "dashboard" / "frontend"


def _read_pid(project_root: Path) -> int | None:
    path = _pid_file(project_root)
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        path.unlink(missing_ok=True)
        return None


def _read_port(project_root: Path) -> int | None:
    path = _port_file(project_root)
    if not path.exists():
        return None
    try:
        value = int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        path.unlink(missing_ok=True)
        return None
    return value if 0 < value < 65536 else None


def _process_alive(pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            handle.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _write_pid(project_root: Path, pid: int) -> None:
    path = _pid_file(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{pid}\n", encoding="utf-8")


def _write_port(project_root: Path, port: int) -> None:
    path = _port_file(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{port}\n", encoding="utf-8")


def _write_status(project_root: Path, payload: dict[str, Any]) -> None:
    path = _status_file(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _cleanup_dashboard_metadata(project_root: Path) -> None:
    _pid_file(project_root).unlink(missing_ok=True)
    _status_file(project_root).unlink(missing_ok=True)
    _port_file(project_root).unlink(missing_ok=True)


def _probe_dashboard_status(port: int, *, timeout: float = 3.0) -> dict[str, Any]:
    opener = build_opener(ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}/api/status", timeout=timeout) as response:  # noqa: S310
        body = response.read().decode("utf-8")
    return json.loads(body)


def _probe_dashboard_frontend(port: int, *, timeout: float = 3.0) -> str:
    opener = build_opener(ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}/", timeout=timeout) as response:  # noqa: S310
        return response.read().decode("utf-8")


def _wait_for_dashboard_status(project_root: Path, port: int, *, timeout: float = 20.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            payload = _probe_dashboard_status(port)
        except (OSError, URLError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(0.25)
            continue
        _write_status(project_root, payload)
        _write_port(project_root, port)
        return payload
    raise RuntimeError(f"Dashboard API did not become ready on port {port}: {last_error!r}")


def _wait_for_dashboard_frontend(port: int, *, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            body = _probe_dashboard_frontend(port)
            if _is_vue_dashboard_html(body):
                return
            last_error = RuntimeError("dashboard served fallback HTML instead of the Vue shell")
        except (OSError, URLError) as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"Dashboard frontend did not become ready on port {port}: {last_error!r}")


def _pid_from_log(project_root: Path) -> int | None:
    log_path = _log_file(project_root)
    if not log_path.exists():
        return None
    for line in reversed(log_path.read_text(encoding="utf-8", errors="ignore").splitlines()):
        marker = "Started server process ["
        if marker not in line:
            continue
        candidate = line.split(marker, 1)[1].split("]", 1)[0].strip()
        if candidate.isdigit():
            return int(candidate)
    return None


def _pid_matches_dashboard(project_root: Path, pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False
    proc_dir = Path("/proc") / str(pid)
    try:
        cmdline = (proc_dir / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", errors="ignore")
    except OSError:
        return False
    if "uvicorn" not in cmdline or "app:app" not in cmdline:
        return False
    try:
        cwd = (proc_dir / "cwd").resolve()
    except OSError:
        return False
    return cwd == _backend_dir(project_root).resolve()


def _dashboard_project_root_for_pid(pid: int) -> Path | None:
    proc_dir = Path("/proc") / str(pid)
    try:
        cmdline = (proc_dir / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", errors="ignore")
    except OSError:
        return None
    if "uvicorn" not in cmdline or "app:app" not in cmdline:
        return None
    try:
        cwd = (proc_dir / "cwd").resolve()
    except OSError:
        return None
    if cwd.name != "backend" or cwd.parent.name != "dashboard" or cwd.parent.parent.name != "tools":
        return None
    return cwd.parent.parent.parent


def _listening_inodes_for_port(port: int) -> set[str]:
    inodes: set[str] = set()
    for table in (Path("/proc/net/tcp"), Path("/proc/net/tcp6")):
        try:
            lines = table.read_text(encoding="utf-8").splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            parts = line.split()
            if len(parts) < 10:
                continue
            local_address = parts[1]
            state = parts[3]
            inode = parts[9]
            try:
                local_port = int(local_address.rsplit(":", 1)[1], 16)
            except (IndexError, ValueError):
                continue
            if local_port == port and state == "0A" and inode != "0":
                inodes.add(inode)
    return inodes


def _pids_for_listening_port(port: int) -> list[int]:
    inodes = _listening_inodes_for_port(port)
    if not inodes:
        return []
    pids: list[int] = []
    for proc_dir in Path("/proc").iterdir():
        if not proc_dir.name.isdigit():
            continue
        fd_dir = proc_dir / "fd"
        try:
            fds = list(fd_dir.iterdir())
        except OSError:
            continue
        for fd in fds:
            try:
                target = os.readlink(fd)
            except OSError:
                continue
            if target.startswith("socket:[") and target[8:-1] in inodes:
                pids.append(int(proc_dir.name))
                break
    return sorted(set(pids))


def _dashboard_port_owner(project_root: Path, port: int) -> dict[str, Any]:
    root = project_root.resolve()
    pids = _pids_for_listening_port(port)
    for pid in pids:
        dashboard_root = _dashboard_project_root_for_pid(pid)
        if dashboard_root and dashboard_root.resolve() == root:
            return {"state": "same_workspace_dashboard", "port": port, "pid": pid, "project_root": str(root)}
    for pid in pids:
        dashboard_root = _dashboard_project_root_for_pid(pid)
        if dashboard_root:
            return {"state": "other_workspace_dashboard", "port": port, "pid": pid, "project_root": str(dashboard_root.resolve())}
    if _port_available(port):
        return {"state": "free", "port": port}
    try:
        status = _probe_dashboard_status(port, timeout=0.5)
    except Exception:
        status = {}
    status_project_root = status.get("project_root") if isinstance(status, dict) else None
    if isinstance(status_project_root, str) and Path(status_project_root).resolve() == root:
        return {"state": "same_workspace_dashboard", "port": port, "project_root": str(root)}
    if isinstance(status, dict) and status.get("runtime"):
        return {"state": "other_workspace_dashboard", "port": port, "project_root": status_project_root}
    return {"state": "occupied", "port": port, "pids": pids}


def _select_dashboard_port(project_root: Path, preferred_port: int) -> tuple[int, dict[str, Any], list[dict[str, Any]]]:
    if preferred_port <= 0 or preferred_port > 65535:
        preferred_port = DEFAULT_DASHBOARD_PORT
    checked: list[dict[str, Any]] = []
    for port in range(preferred_port, min(65535, preferred_port + DASHBOARD_PORT_SCAN_LIMIT) + 1):
        owner = _dashboard_port_owner(project_root, port)
        checked.append(owner)
        if owner.get("state") in {"free", "same_workspace_dashboard"}:
            return port, owner, checked
    raise RuntimeError(
        f"No dashboard port available from {preferred_port} to {min(65535, preferred_port + DASHBOARD_PORT_SCAN_LIMIT)}"
    )


def _is_vue_dashboard_html(body: str) -> bool:
    return "<div id=\"app\"" in body or "<div id='app'" in body


def _frontend_dist_valid(frontend_dir: Path) -> bool:
    index_path = frontend_dir / "dist" / "index.html"
    if not index_path.is_file():
        return False
    try:
        return _is_vue_dashboard_html(index_path.read_text(encoding="utf-8"))
    except OSError:
        return False


def _source_newer_than_dist(frontend_dir: Path) -> bool:
    index_path = frontend_dir / "dist" / "index.html"
    if not index_path.exists():
        return True
    try:
        dist_mtime = index_path.stat().st_mtime
    except OSError:
        return True
    watched_roots = [frontend_dir / "src"]
    watched_files = [
        frontend_dir / "package.json",
        frontend_dir / "package-lock.json",
        frontend_dir / "vite.config.ts",
        frontend_dir / "tsconfig.json",
        frontend_dir / "tsconfig.node.json",
        frontend_dir / "index.html",
    ]
    for path in watched_files:
        try:
            if path.exists() and path.stat().st_mtime > dist_mtime:
                return True
        except OSError:
            return True
    for root in watched_roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            try:
                if path.stat().st_mtime > dist_mtime:
                    return True
            except OSError:
                return True
    return False


def _frontend_dependencies_ready(frontend_dir: Path) -> bool:
    if not (frontend_dir / "package.json").is_file():
        return True
    node_modules = frontend_dir / "node_modules"
    if not node_modules.is_dir():
        return False
    for binary in ("vue-tsc", "vite"):
        binary_path = node_modules / ".bin" / binary
        if not binary_path.exists():
            return False
        if os.name != "nt" and not binary_path.is_symlink():
            return False
    for package_path in (
        "vue-tsc/package.json",
        "vite/package.json",
        "typescript/package.json",
        "@vitejs/plugin-vue/package.json",
    ):
        if not (node_modules / package_path).exists():
            return False
    return True


def _run_frontend_command(frontend_dir: Path, args: list[str]) -> None:
    try:
        subprocess.run(args, cwd=str(frontend_dir), check=True)
    except FileNotFoundError as exc:
        raise RuntimeError("Dashboard frontend requires npm, but npm was not found on PATH.") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Dashboard frontend command failed: {' '.join(args)}") from exc


def _ensure_frontend_ready(project_root: Path, *, force_build: bool) -> dict[str, Any]:
    frontend_dir = _frontend_dir(project_root)
    if not frontend_dir.is_dir():
        return {"status": "skipped", "reason": "frontend_dir_missing"}
    installed = False
    if not _frontend_dependencies_ready(frontend_dir):
        install_args = ["npm", "ci", "--legacy-peer-deps"] if (frontend_dir / "package-lock.json").exists() else ["npm", "install", "--legacy-peer-deps"]
        _run_frontend_command(frontend_dir, install_args)
        installed = True
    build_needed = force_build or not _frontend_dist_valid(frontend_dir) or _source_newer_than_dist(frontend_dir)
    if build_needed:
        _run_frontend_command(frontend_dir, ["npm", "run", "build"])
    if not _frontend_dist_valid(frontend_dir):
        raise RuntimeError(f"Dashboard frontend build did not produce a Vue shell at {frontend_dir / 'dist' / 'index.html'}")
    return {
        "status": "ok",
        "installed": installed,
        "built": build_needed,
        "dist": str(frontend_dir / "dist" / "index.html"),
    }


def start_dashboard(project_root: Path, *, rebuild: bool = False) -> dict[str, Any]:
    pid = _read_pid(project_root)
    metadata_port = _read_port(project_root)
    preferred_port = metadata_port or dashboard_port(project_root)
    frontend_status = _ensure_frontend_ready(project_root, force_build=rebuild)
    if _process_alive(pid) and _pid_matches_dashboard(project_root, pid):
        port = metadata_port or dashboard_port(project_root)
        _wait_for_dashboard_status(project_root, port)
        _wait_for_dashboard_frontend(port)
        return {
            "status": "ok",
            "action": "start",
            "summary": f"Dashboard already running at http://localhost:{port}",
            "pid": pid,
            "port": port,
            "url": f"http://localhost:{port}",
            "reused": True,
            "frontend": frontend_status,
        }
    _cleanup_dashboard_metadata(project_root)

    backend_dir = _backend_dir(project_root)
    if not backend_dir.is_dir():
        raise FileNotFoundError(f"Dashboard backend not found at {backend_dir}")

    port, port_owner, checked_ports = _select_dashboard_port(project_root, preferred_port)
    if port_owner.get("state") == "same_workspace_dashboard":
        owner_pid = port_owner.get("pid")
        if isinstance(owner_pid, int):
            _write_pid(project_root, owner_pid)
        _wait_for_dashboard_status(project_root, port)
        _wait_for_dashboard_frontend(port)
        return {
            "status": "ok",
            "action": "start",
            "summary": f"Dashboard already running at http://localhost:{port}",
            "pid": owner_pid,
            "port": port,
            "url": f"http://localhost:{port}",
            "reused": True,
            "frontend": frontend_status,
            "port_owner": port_owner,
            "checked_ports": checked_ports,
        }
    log_path = _log_file(project_root)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    python_bin = _python_bin(project_root)
    log_handle = log_path.open("a", encoding="utf-8")
    try:
        proc = subprocess.Popen(
            [
                python_bin,
                "-m",
                "uvicorn",
                "app:app",
                "--host",
                "0.0.0.0",
                "--port",
                str(port),
            ],
            cwd=str(backend_dir),
            env=os.environ.copy(),
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            text=True,
        )
    except OSError as exc:
        log_handle.close()
        raise RuntimeError(f"Dashboard launch failed. Check {_log_file(project_root)}") from exc
    finally:
        log_handle.close()
    _write_pid(project_root, proc.pid)
    time.sleep(0.5)
    try:
        _wait_for_dashboard_status(project_root, port)
        _wait_for_dashboard_frontend(port)
    except RuntimeError:
        if proc.poll() is None:
            proc.terminate()
        _cleanup_dashboard_metadata(project_root)
        raise RuntimeError(f"Dashboard failed to start. Check {_log_file(project_root)}")
    pid = _read_pid(project_root) or _pid_from_log(project_root) or proc.pid
    if pid:
        _write_pid(project_root, pid)
    return {
        "status": "ok",
        "action": "start",
        "summary": f"Dashboard running at http://localhost:{port}",
        "pid": pid,
        "port": port,
        "url": f"http://localhost:{port}",
        "reused": False,
        "frontend": frontend_status,
        "port_owner": port_owner,
        "checked_ports": checked_ports,
    }


def stop_dashboard(project_root: Path) -> dict[str, Any]:
    pid = _read_pid(project_root)
    if not _process_alive(pid) or not _pid_matches_dashboard(project_root, pid):
        _cleanup_dashboard_metadata(project_root)
        return {"status": "ok", "action": "stop", "summary": "Dashboard is not running.", "pid": None}

    os.kill(pid, signal.SIGTERM)
    deadline = time.time() + 5.0
    while time.time() < deadline and _process_alive(pid):
        time.sleep(0.25)
    if _process_alive(pid):
        os.kill(pid, signal.SIGKILL)
    _cleanup_dashboard_metadata(project_root)
    return {"status": "ok", "action": "stop", "summary": f"Dashboard stopped (PID: {pid})", "pid": pid}


def rebuild_dashboard(project_root: Path) -> dict[str, Any]:
    stop_dashboard(project_root)
    return start_dashboard(project_root, rebuild=True)


def manage_dashboard(project_root: Path, action: str) -> dict[str, Any]:
    action = action.strip().lower()
    if action == "start":
        return start_dashboard(project_root)
    if action == "stop":
        return stop_dashboard(project_root)
    if action == "rebuild":
        return rebuild_dashboard(project_root)
    raise ValueError(f"Unknown dashboard action: {action}")


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Thoth dashboard manager")
    parser.add_argument("action", nargs="?", default="start", choices=("start", "stop", "rebuild"))
    args = parser.parse_args(argv)
    result = manage_dashboard(Path.cwd(), args.action)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0
