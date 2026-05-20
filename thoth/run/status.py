"""Canonical runtime status read payload."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from thoth.objects import summarize_object_graph
from thoth.plan.compiler import collect_legacy_authority_rows

from .io import local_registry_root
from .model import LIVE_DISPATCH_MODE, SLEEP_DISPATCH_MODE, default_executor
from .service import list_active_runs


def _read_only_compiler_summary(project_root: Path) -> dict[str, Any]:
    graph = summarize_object_graph(project_root, ensure_tree=False)
    summary = dict(graph.get("summary", {}))
    summary["legacy_authority_count"] = len(collect_legacy_authority_rows(project_root))
    return summary


def build_status_payload(project_root: Path) -> dict[str, Any]:
    active_runs = list_active_runs(project_root)
    return {
        "project_root": str(project_root.resolve()),
        "active_run_count": len(active_runs),
        "active_runs": active_runs,
        "local_registry": str(local_registry_root(project_root)),
        "compiler": _read_only_compiler_summary(project_root),
        "runtime_defaults": {
            "default_executor": default_executor(),
            "public_execution_default_executor": "codex",
            "codex_surface_default_executor": "codex",
            "claude_execution_default_executor": "codex",
            "live_dispatch_mode": LIVE_DISPATCH_MODE,
            "sleep_dispatch_mode": SLEEP_DISPATCH_MODE,
        },
    }
