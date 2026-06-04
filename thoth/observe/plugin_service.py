"""CLI-facing project extension management helpers.

The manifest still stores entries under ``plugins`` for schema compatibility,
but public receipts and errors use the extension terminology.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from thoth.observe.actions import record_action_receipt
from thoth.observe.extensions import (
    EXTENSIONS_MANIFEST,
    ensure_extension_manifest,
    extension_summary,
    manifest_path,
    manifest_validation_errors,
)
from thoth.privacy import finding_messages, scan_plugin_tree


PLUGIN_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$")


def _manifest(project_root: Path) -> dict[str, Any]:
    return ensure_extension_manifest(project_root)


def _write_manifest(project_root: Path, manifest: dict[str, Any]) -> None:
    path = manifest_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _split_csv(value: str | None, *, default: tuple[str, ...]) -> list[str]:
    if not value:
        return list(default)
    return [item.strip() for item in value.split(",") if item.strip()]


def _validate_plugin_id(plugin_id: str) -> None:
    if not PLUGIN_ID_RE.match(plugin_id):
        raise ValueError("extension id must match [a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}")


def _safe_source(project_root: Path, plugin_id: str, source: str | None) -> str:
    rel = source or f".thoth/extensions/plugins/{plugin_id}"
    path = Path(rel)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("extension source must be project-relative and cannot contain '..'")
    return str(path)


def create_plugin(
    project_root: Path,
    *,
    plugin_id: str,
    title: str | None = None,
    version: str = "0.1.0",
    surfaces: str | None = None,
    capabilities: str | None = None,
    source: str | None = None,
    description: str = "",
    enabled: bool = True,
    trusted: bool = False,
    force: bool = False,
) -> dict[str, Any]:
    _validate_plugin_id(plugin_id)
    manifest = _manifest(project_root)
    rows = manifest.get("plugins")
    if not isinstance(rows, list):
        rows = []
        manifest["plugins"] = rows
    existing = [row for row in rows if isinstance(row, dict) and row.get("id") == plugin_id]
    if existing and not force:
        raise ValueError(f"extension already exists: {plugin_id}")
    plugin_source = _safe_source(project_root, plugin_id, source)
    plugin = {
        "id": plugin_id,
        "title": title or plugin_id,
        "version": version,
        "enabled": enabled,
        "trusted": trusted,
        "surfaces": _split_csv(surfaces, default=("dashboard", "tui")),
        "capabilities": _split_csv(capabilities, default=("tool",)),
        "source": plugin_source,
        "description": description,
        "config": {},
    }
    if existing:
        rows[:] = [plugin if isinstance(row, dict) and row.get("id") == plugin_id else row for row in rows]
    else:
        rows.append(plugin)
    _write_manifest(project_root, manifest)
    source_dir = project_root / plugin_source
    source_dir.mkdir(parents=True, exist_ok=True)
    readme = source_dir / "README.md"
    if not readme.exists():
        readme.write_text(f"# {plugin['title']}\n\nLocal Thoth extension `{plugin_id}`.\n", encoding="utf-8")
    receipt = record_action_receipt(
        project_root,
        action="extension.create",
        status="ok",
        summary=f"Extension {plugin_id} created.",
        request={"plugin_id": plugin_id, "force": force},
        result={"extension": plugin, "manifest_path": EXTENSIONS_MANIFEST},
        artifacts=[EXTENSIONS_MANIFEST, plugin_source],
    )
    return {"extension": plugin, "manifest_path": EXTENSIONS_MANIFEST, "receipt": receipt}


def list_plugins(project_root: Path) -> dict[str, Any]:
    _manifest(project_root)
    return extension_summary(project_root)


def validate_plugins(project_root: Path, *, fix: bool = False) -> dict[str, Any]:
    migration = None
    if fix:
        from thoth.observe.extensions import migrate_extension_manifest_file

        migration = migrate_extension_manifest_file(project_root)
    else:
        _manifest(project_root)
    errors = manifest_validation_errors(project_root)
    privacy_findings = scan_plugin_tree(project_root)
    errors.extend(f"privacy: {message}" for message in finding_messages(privacy_findings))
    summary = extension_summary(project_root)
    status = "ok" if not errors else "failed"
    receipt = record_action_receipt(
        project_root,
        action="extension.validate",
        status=status,
        summary="Extension manifest validation passed." if not errors else "Extension manifest validation failed.",
        request={"fix": fix},
        result={
            "errors": errors,
            "migration": migration,
            "privacy_findings": finding_messages(privacy_findings),
            "summary": summary,
        },
        artifacts=[EXTENSIONS_MANIFEST],
    )
    return {
        "status": status,
        "errors": errors,
        "summary": summary,
        "migration": migration,
        "privacy_findings": finding_messages(privacy_findings),
        "receipt": receipt,
    }
