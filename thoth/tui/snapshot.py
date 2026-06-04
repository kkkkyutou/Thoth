"""Agent-safe TUI snapshot builder."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from thoth.observe.actions import action_catalog
from thoth.observe.logs import logs_provider
from thoth.observe.providers import observe_snapshot, stamp_provider

from .ansi import has_ansi
from .gpu import snapshot_gpu
from .metrics import DEFAULT_GLOBAL_MAX_POINTS, DEFAULT_LOCAL_WINDOW_STEPS
from .preferences import PREFERENCE_PATH, load_preferences
from .plugin_api import tui_plugin_audit_notices


def build_snapshot(
    *,
    project_root: str | Path = ".",
    no_gpu: bool = False,
    metrics_max_records: int = 200000,
    no_python_plugins: bool = False,
    local_window_steps: int = DEFAULT_LOCAL_WINDOW_STEPS,
    global_max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
    decimal_places: int = 5,
) -> dict[str, Any]:
    root = Path(project_root).resolve()
    shared = observe_snapshot(
        root,
        include_gpu=not no_gpu,
        metrics_max_records=metrics_max_records,
        local_window_steps=local_window_steps,
        global_max_points=global_max_points,
        decimal_places=decimal_places,
    )
    shared_gpu = (shared.get("providers", {}).get("system", {}) or {}).get("gpu")
    gpu_payload = snapshot_gpu(disabled=True) if no_gpu else shared_gpu or snapshot_gpu(disabled=False)
    plugin_notices = tui_plugin_audit_notices(root, no_python_plugins=no_python_plugins)
    logs = logs_provider(root)
    preferences = load_preferences(root)
    shared["providers"]["logs"] = logs
    payload = {
        "schema_version": 1,
        "generated_at": shared["generated_at"],
        "project_root": str(root),
        "providers": shared["providers"],
        "overview": shared["overview"],
        "metrics": shared["providers"].get("metrics", {}),
        "gpu": stamp_provider(gpu_payload, refresh_seconds=None),
        "tui": {
            "schema_version": 1,
            "surface_version": 3,
            "no_python_plugins": no_python_plugins,
            "local_window_steps": local_window_steps,
            "global_max_points": global_max_points,
            "decimal_places": decimal_places,
            "preferences_path": PREFERENCE_PATH,
            "preferences": preferences,
            "actions": action_catalog(),
            "python_plugin_notices": plugin_notices,
            "renderer_executed": False,
        },
    }
    text = json.dumps(payload, ensure_ascii=False)
    if has_ansi(text):
        raise ValueError("TUI snapshot JSON must not contain ANSI escape sequences")
    return payload
