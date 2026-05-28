"""Agent-safe TUI snapshot builder."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from thoth.observe.providers import observe_snapshot, stamp_provider

from .ansi import has_ansi
from .gpu import snapshot_gpu


def build_snapshot(
    *,
    project_root: str | Path = ".",
    no_gpu: bool = False,
    metrics_max_records: int = 200000,
) -> dict[str, Any]:
    root = Path(project_root).resolve()
    shared = observe_snapshot(root, include_gpu=not no_gpu)
    shared_gpu = (shared.get("providers", {}).get("system", {}) or {}).get("gpu")
    gpu_payload = snapshot_gpu(disabled=True) if no_gpu else shared_gpu or snapshot_gpu(disabled=False)
    payload = {
        "schema_version": 1,
        "generated_at": shared["generated_at"],
        "project_root": str(root),
        "providers": shared["providers"],
        "overview": shared["overview"],
        "metrics": shared["providers"].get("metrics", {}),
        "gpu": stamp_provider(gpu_payload, refresh_seconds=None),
    }
    text = json.dumps(payload, ensure_ascii=False)
    if has_ansi(text):
        raise ValueError("TUI snapshot JSON must not contain ANSI escape sequences")
    return payload
