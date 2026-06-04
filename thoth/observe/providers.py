"""Shared read providers for Dashboard and TUI surfaces."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thoth.objects import summarize_object_graph
from thoth.observe.experiments import ExperimentFilters, experiment_provider, metrics_for_experiment
from thoth.observe.extensions import extension_summary, system_plugin_configs, tool_plugins
from thoth.observe.read_model import active_auto_controllers, load_config, load_tasks, overview_summary_read_model
from thoth.run.io import _read_json
from thoth.run.service import list_active_runs
from thoth.tui.gpu import snapshot_gpu
from thoth.tui.metrics import DEFAULT_GLOBAL_MAX_POINTS, DEFAULT_LOCAL_WINDOW_STEPS


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp_provider(
    payload: dict[str, Any],
    *,
    refresh_seconds: float | None = None,
    last_refreshed_epoch: float | None = None,
    last_error: str | None = None,
) -> dict[str, Any]:
    now = time.time()
    refreshed = now if last_refreshed_epoch is None else float(last_refreshed_epoch)
    payload["provider"] = {
        "last_refreshed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(refreshed)),
        "last_refreshed_epoch": refreshed,
        "refresh_seconds": refresh_seconds,
        "stale_seconds": max(0.0, now - refreshed),
        "last_error": last_error,
    }
    return payload


def _read_jsonl_tail(path: Path, *, limit: int = 40) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    for line_no, raw in enumerate(lines[-limit:], start=max(1, len(lines) - limit + 1)):
        if not raw.strip():
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            payload.setdefault("seq", payload.get("seq", line_no))
            rows.append(payload)
    return rows


def _all_run_rows(project_root: Path) -> list[dict[str, Any]]:
    runs_dir = project_root / ".thoth" / "runs"
    rows: list[dict[str, Any]] = []
    if not runs_dir.is_dir():
        return rows
    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        run = _read_json(run_dir / "run.json")
        state = _read_json(run_dir / "state.json")
        result = _read_json(run_dir / "result.json")
        artifacts = _read_json(run_dir / "artifacts.json")
        events = _read_jsonl_tail(run_dir / "events.jsonl", limit=8)
        run_id = str(run.get("run_id") or state.get("run_id") or run_dir.name)
        status = str(state.get("status") or result.get("status") or run.get("status") or "unknown")
        rows.append(
            {
                "run_id": run_id,
                "work_id": run.get("work_id") or state.get("work_id"),
                "title": run.get("title") or run_id,
                "host": run.get("host"),
                "executor": run.get("executor"),
                "status": status,
                "phase": state.get("phase") or run.get("phase"),
                "progress_pct": state.get("progress_pct") if isinstance(state.get("progress_pct"), (int, float)) else 0,
                "attachable": bool(run.get("attachable", True)),
                "supervisor_state": state.get("supervisor_state"),
                "last_heartbeat_at": state.get("last_heartbeat_at"),
                "updated_at": state.get("updated_at") or result.get("updated_at") or run.get("updated_at") or run.get("created_at"),
                "artifact_count": len(artifacts.get("artifacts", [])) if isinstance(artifacts.get("artifacts"), list) else 0,
                "latest_message": events[-1].get("message") if events else "",
                "events": events,
                "is_active": status in {"queued", "running", "paused", "waiting_input", "stopping"},
            }
        )
    rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return rows


def project_provider(project_root: Path) -> dict[str, Any]:
    return stamp_provider({"schema_version": 1, "kind": "project", **load_config(project_root)})


def authority_provider(project_root: Path) -> dict[str, Any]:
    graph = summarize_object_graph(project_root, ensure_tree=False)
    return stamp_provider(
        {
            "schema_version": 1,
            "kind": "authority",
            "summary": graph.get("summary", {}),
            "blocked_work_ids": graph.get("blocked_work_ids", []),
            "invalid_work_ids": graph.get("invalid_work_ids", []),
            "problems": graph.get("problems", []),
            "generated_at": graph.get("generated_at"),
        }
    )


def work_items_provider(project_root: Path) -> dict[str, Any]:
    rows = load_tasks(project_root)
    counts: dict[str, int] = {}
    for row in rows:
        status = str(row.get("authority_status") or row.get("ready_state") or row.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return stamp_provider(
        {
            "schema_version": 1,
            "kind": "work_items",
            "count": len(rows),
            "status_counts": counts,
            "work_items": rows,
        }
    )


def runs_provider(project_root: Path) -> dict[str, Any]:
    runs = _all_run_rows(project_root)
    active_runs = list_active_runs(project_root)
    counts: dict[str, int] = {}
    for row in runs:
        status = str(row.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return stamp_provider(
        {
            "schema_version": 1,
            "kind": "runs",
            "run_count": len(runs),
            "active_count": len(active_runs),
            "status_counts": counts,
            "runs": runs,
            "active_runs": active_runs,
            "auto_controllers": active_auto_controllers(project_root),
        }
    )


def metrics_provider(
    project_root: Path,
    *,
    max_records: int = 200000,
    local_window_steps: int = DEFAULT_LOCAL_WINDOW_STEPS,
    global_max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
    decimal_places: int = 5,
) -> dict[str, Any]:
    payload = metrics_for_experiment(
        project_root,
        max_records=max_records,
        local_window_steps=local_window_steps,
        global_max_points=global_max_points,
        decimal_places=decimal_places,
    )
    return stamp_provider(
        payload,
        last_error="; ".join(payload.get("provider_errors") or []) if payload.get("provider_errors") else None,
    )


def experiments_provider(project_root: Path) -> dict[str, Any]:
    return stamp_provider(experiment_provider(project_root, ExperimentFilters(limit=100, offset=0)))


def plugins_provider(project_root: Path) -> dict[str, Any]:
    return stamp_provider({"schema_version": 1, "kind": "plugins", **extension_summary(project_root)})


def tools_provider(project_root: Path) -> dict[str, Any]:
    tools = tool_plugins(project_root)
    return stamp_provider({"schema_version": 1, "kind": "tools", "tool_count": len(tools), "tools": tools})


def _configured_system_snapshot(project_root: Path) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    for config in system_plugin_configs(project_root):
        item = config.get("system_file") or config.get("gpu_file")
        if not isinstance(item, str) or not item.strip():
            errors.append(f"{config.get('plugin_id', 'plugin')}: config.system_file is required")
            continue
        path = Path(item)
        if not path.is_absolute():
            path = project_root / path
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except OSError:
            errors.append(f"missing system file: {path}")
            continue
        except json.JSONDecodeError as exc:
            errors.append(f"invalid system file: {path}: {exc}")
            continue
        if isinstance(payload, dict):
            payload.setdefault("source_file", str(path))
            payload.setdefault("source", "extension")
            return payload, errors
        errors.append(f"system file must contain an object: {path}")
    return None, errors


def _host_system_snapshot() -> dict[str, Any]:
    try:
        import psutil  # type: ignore
    except Exception as exc:
        return {"system_error": f"psutil_unavailable: {type(exc).__name__}"}
    try:
        memory = psutil.virtual_memory()
        return {
            "cpu": {
                "logical_cores": psutil.cpu_count(logical=True),
                "physical_cores": psutil.cpu_count(logical=False),
                "load_pct": psutil.cpu_percent(interval=None),
            },
            "memory": {
                "used_gb": round(float(memory.used) / 1024 / 1024 / 1024, 2),
                "total_gb": round(float(memory.total) / 1024 / 1024 / 1024, 2),
                "utilization_pct": float(memory.percent),
            },
        }
    except Exception as exc:
        return {"system_error": f"psutil_error: {type(exc).__name__}: {exc}"}


def system_provider(project_root: Path, *, include_gpu: bool = True) -> dict[str, Any]:
    configured, provider_errors = _configured_system_snapshot(project_root) if include_gpu else (None, [])
    gpu = configured.get("gpu") if isinstance(configured, dict) and isinstance(configured.get("gpu"), dict) else None
    host_snapshot = {} if configured else _host_system_snapshot()
    payload = {
        "schema_version": 1,
        "kind": "system",
        "project_root": str(project_root.resolve()),
        "generated_at": utc_now(),
        "gpu": gpu or snapshot_gpu(disabled=not include_gpu),
        "configured": configured is not None,
        "provider_errors": provider_errors,
        **host_snapshot,
    }
    if configured:
        for key, value in configured.items():
            if key not in {"schema_version", "kind", "gpu"}:
                payload[key] = value
    return stamp_provider(
        payload,
        last_error="; ".join(provider_errors) if provider_errors else None,
    )


def observe_snapshot(
    project_root: Path,
    *,
    include_gpu: bool = True,
    metrics_max_records: int = 200000,
    local_window_steps: int = DEFAULT_LOCAL_WINDOW_STEPS,
    global_max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
    decimal_places: int = 5,
) -> dict[str, Any]:
    """Build the shared read snapshot used by dashboard and TUI surfaces."""

    project_root = project_root.resolve()
    providers = {
        "project": project_provider(project_root),
        "authority": authority_provider(project_root),
        "work_items": work_items_provider(project_root),
        "runs": runs_provider(project_root),
        "experiments": experiments_provider(project_root),
        "metrics": metrics_provider(
            project_root,
            max_records=metrics_max_records,
            local_window_steps=local_window_steps,
            global_max_points=global_max_points,
            decimal_places=decimal_places,
        ),
        "plugins": plugins_provider(project_root),
        "tools": tools_provider(project_root),
        "system": system_provider(project_root, include_gpu=include_gpu),
    }
    try:
        overview = overview_summary_read_model(project_root)
    except Exception as exc:  # pragma: no cover - surfaced in provider metadata.
        overview = {"provider_error": f"{type(exc).__name__}: {exc}"}
    return {
        "schema_version": 1,
        "generated_at": utc_now(),
        "project_root": str(project_root),
        "providers": providers,
        "overview": overview,
    }
