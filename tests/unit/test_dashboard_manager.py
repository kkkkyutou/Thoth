from __future__ import annotations

import subprocess
from pathlib import Path

from thoth.observe import dashboard


def _make_dashboard_tree(project_root: Path) -> None:
    (project_root / "tools" / "dashboard" / "backend").mkdir(parents=True)
    frontend = project_root / "tools" / "dashboard" / "frontend"
    frontend.mkdir(parents=True)
    (frontend / "package.json").write_text('{"scripts":{"build":"vite build"}}\n', encoding="utf-8")
    (frontend / "package-lock.json").write_text('{"lockfileVersion":3}\n', encoding="utf-8")
    (frontend / "src").mkdir()
    (frontend / "src" / "main.ts").write_text("console.log('dashboard')\n", encoding="utf-8")


def test_frontend_ready_installs_dependencies_and_builds(monkeypatch, tmp_path):
    _make_dashboard_tree(tmp_path)
    frontend = tmp_path / "tools" / "dashboard" / "frontend"
    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(list(args))
        if args == ["npm", "ci", "--legacy-peer-deps"]:
            (frontend / "node_modules" / ".bin").mkdir(parents=True)
            (frontend / "node_modules" / ".bin" / "vue-tsc").write_text("", encoding="utf-8")
            (frontend / "node_modules" / ".bin" / "vite").write_text("", encoding="utf-8")
        if args == ["npm", "run", "build"]:
            (frontend / "dist").mkdir()
            (frontend / "dist" / "index.html").write_text(
                '<!doctype html><html><body><div id="app"></div></body></html>',
                encoding="utf-8",
            )
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(dashboard.subprocess, "run", fake_run)

    result = dashboard._ensure_frontend_ready(tmp_path, force_build=False)

    assert result["status"] == "ok"
    assert result["built"] is True
    assert calls == [["npm", "ci", "--legacy-peer-deps"], ["npm", "run", "build"]]


def test_select_dashboard_port_skips_foreign_occupied_port(monkeypatch, tmp_path):
    def fake_owner(_project_root: Path, port: int) -> dict:
        if port == 8501:
            return {"state": "other_workspace_dashboard", "port": port, "pid": 123, "project_root": "/tmp/other"}
        return {"state": "free", "port": port}

    monkeypatch.setattr(dashboard, "_dashboard_port_owner", fake_owner)

    port, owner, checked = dashboard._select_dashboard_port(tmp_path, 8501)

    assert port == 8502
    assert owner["state"] == "free"
    assert [row["port"] for row in checked] == [8501, 8502]


def test_start_dashboard_uses_next_free_port_when_preferred_is_occupied(monkeypatch, tmp_path):
    _make_dashboard_tree(tmp_path)
    launched: list[int] = []

    monkeypatch.setattr(dashboard, "dashboard_port", lambda _root: 8501)
    monkeypatch.setattr(dashboard, "_ensure_frontend_ready", lambda _root, force_build: {"status": "ok", "built": False})
    monkeypatch.setattr(
        dashboard,
        "_dashboard_port_owner",
        lambda _root, port: {"state": "occupied", "port": port, "pids": [321]} if port == 8501 else {"state": "free", "port": port},
    )
    monkeypatch.setattr(
        dashboard,
        "_wait_for_dashboard_status",
        lambda root, port, timeout=20.0: (dashboard._write_port(root, port) or dashboard._write_status(root, {"runtime": {}}) or {"runtime": {}}),
    )
    monkeypatch.setattr(dashboard, "_wait_for_dashboard_frontend", lambda port, timeout=20.0: None)

    class FakeProcess:
        pid = 4242

        def poll(self):
            return None

        def terminate(self):
            return None

    def fake_popen(args, **kwargs):
        launched.append(8502 if "--port" in args and args[args.index("--port") + 1] == "8502" else 0)
        return FakeProcess()

    monkeypatch.setattr(dashboard.subprocess, "Popen", fake_popen)

    result = dashboard.start_dashboard(tmp_path)

    assert result["status"] == "ok"
    assert result["port"] == 8502
    assert result["reused"] is False
    assert "warnings" in result
    assert launched == [8502]
    assert (tmp_path / ".thoth" / "derived" / "dashboard.port").read_text(encoding="utf-8").strip() == "8502"


def test_start_dashboard_reuses_same_workspace_dashboard_without_metadata(monkeypatch, tmp_path):
    _make_dashboard_tree(tmp_path)
    monkeypatch.setattr(dashboard, "dashboard_port", lambda _root: 8501)
    monkeypatch.setattr(dashboard, "_ensure_frontend_ready", lambda _root, force_build: {"status": "ok", "built": False})
    monkeypatch.setattr(
        dashboard,
        "_dashboard_port_owner",
        lambda _root, port: {"state": "same_workspace_dashboard", "port": port, "pid": 4321, "project_root": str(tmp_path)},
    )
    monkeypatch.setattr(
        dashboard,
        "_wait_for_dashboard_status",
        lambda root, port, timeout=20.0: (dashboard._write_port(root, port) or dashboard._write_status(root, {"runtime": {}}) or {"runtime": {}}),
    )
    monkeypatch.setattr(dashboard, "_wait_for_dashboard_frontend", lambda port, timeout=20.0: None)

    def fail_popen(*_args, **_kwargs):
        raise AssertionError("same-workspace dashboard should be reused without launching another server")

    monkeypatch.setattr(dashboard.subprocess, "Popen", fail_popen)

    result = dashboard.start_dashboard(tmp_path)

    assert result["status"] == "ok"
    assert result["port"] == 8501
    assert result["pid"] == 4321
    assert result["reused"] is True
    assert "warnings" in result
    assert (tmp_path / ".thoth" / "derived" / "dashboard.pid").read_text(encoding="utf-8").strip() == "4321"


def test_dashboard_rebuild_documents_not_scaffold_sync(monkeypatch, tmp_path):
    started: list[bool] = []

    monkeypatch.setattr(dashboard, "stop_dashboard", lambda _root: {"status": "ok", "action": "stop"})

    def fake_start(_root: Path, *, rebuild: bool = False) -> dict:
        started.append(rebuild)
        return {"status": "ok", "action": "start", "summary": "Dashboard running", "warnings": []}

    monkeypatch.setattr(dashboard, "start_dashboard", fake_start)

    result = dashboard.rebuild_dashboard(tmp_path)

    assert started == [True]
    assert "does not sync dashboard scaffold templates" in result["rebuild_note"]
