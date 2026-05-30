"""Debug summary data for dashboard/backend diagnostics."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from thoth.observe.actions import action_receipt_summary
from thoth.observe.extensions import extension_summary
from thoth.observe.invalidation import invalidation_snapshot


def debug_summary(project_root: Path) -> dict[str, Any]:
    plugins = extension_summary(project_root)
    return {
        "schema_version": 1,
        "project_root": str(project_root.resolve()),
        "plugins": {
            "manifest_path": plugins.get("manifest_path"),
            "schema_version": plugins.get("schema_version"),
            "plugin_count": plugins.get("plugin_count", 0),
            "enabled_plugin_count": plugins.get("enabled_plugin_count", 0),
            "validation_errors": plugins.get("validation_errors", []),
            "debug": plugins.get("debug", {}),
        },
        "actions": action_receipt_summary(project_root),
        "invalidation": invalidation_snapshot(project_root),
    }
