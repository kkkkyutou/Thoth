"""Project extension manifest support for Thoth read surfaces."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import Any


EXTENSIONS_DIR = ".thoth/extensions"
EXTENSIONS_MANIFEST = f"{EXTENSIONS_DIR}/manifest.json"
MANIFEST_SCHEMA_VERSION = 2


BUILTIN_TOOL_PLUGINS: tuple[dict[str, Any], ...] = (
    {
        "id": "todo",
        "title": "Local Todo",
        "kind": "tool",
        "capabilities": ["local_db_write"],
        "enabled": True,
        "description": "Project-local todo database tools isolated from authority.",
    },
    {
        "id": "thoth-triggers",
        "title": "Thoth Triggers",
        "kind": "tool",
        "capabilities": ["command_trigger"],
        "enabled": True,
        "description": "Explicit dashboard actions for validate, sync, and health-check commands.",
    },
)


DEFAULT_EXTENSION_MANIFEST: dict[str, Any] = {
    "schema_version": MANIFEST_SCHEMA_VERSION,
    "kind": "thoth.extensions",
    "plugins": [],
    "actions": [],
    "builtin_tools": list(BUILTIN_TOOL_PLUGINS),
}


@dataclass(frozen=True)
class ExtensionPlugin:
    plugin_id: str
    version: str
    enabled: bool
    surfaces: tuple[str, ...]
    capabilities: tuple[str, ...]
    source: str
    config: dict[str, Any]
    title: str = ""
    description: str = ""
    trusted: bool = False

    @property
    def has_metrics(self) -> bool:
        return "metrics_provider" in self.capabilities or "loss_provider" in self.capabilities

    @property
    def has_system(self) -> bool:
        return "system_provider" in self.capabilities or "gpu_provider" in self.capabilities


def extensions_dir(project_root: Path) -> Path:
    return project_root / EXTENSIONS_DIR


def manifest_path(project_root: Path) -> Path:
    return project_root / EXTENSIONS_MANIFEST


def default_manifest() -> dict[str, Any]:
    return json.loads(json.dumps(DEFAULT_EXTENSION_MANIFEST))


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def migrate_extension_manifest_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Return a schema v2 manifest while preserving schema v1 plugin rows."""

    original_version = payload.get("schema_version")
    if original_version == MANIFEST_SCHEMA_VERSION:
        migrated = dict(payload)
        migrated.setdefault("kind", "thoth.extensions")
        migrated.setdefault("plugins", [])
        migrated.setdefault("actions", [])
        migrated.setdefault("builtin_tools", list(BUILTIN_TOOL_PLUGINS))
        return migrated, None
    if original_version not in (None, 1):
        migrated = dict(payload)
        migrated.setdefault("plugins", [])
        migrated.setdefault("actions", [])
        migrated.setdefault("builtin_tools", list(BUILTIN_TOOL_PLUGINS))
        return migrated, None

    migrated = default_manifest()
    rows = payload.get("plugins")
    migrated["plugins"] = rows if isinstance(rows, list) else []
    builtin_tools = payload.get("builtin_tools")
    if isinstance(builtin_tools, list):
        migrated["builtin_tools"] = builtin_tools
    actions = payload.get("actions")
    if isinstance(actions, list):
        migrated["actions"] = actions
    migration = {
        "from_schema_version": 1 if original_version in (None, 1) else original_version,
        "to_schema_version": MANIFEST_SCHEMA_VERSION,
        "migrated_at": _utc_iso(),
    }
    migrated["last_migration"] = migration
    return migrated, migration


def migrate_extension_manifest_file(project_root: Path) -> dict[str, Any]:
    """Upgrade an existing v1 manifest to schema v2 on disk when needed."""

    path = manifest_path(project_root)
    if not path.exists():
        return {"changed": False, "manifest": default_manifest(), "migration": None}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"changed": False, "manifest": load_extension_manifest(project_root), "migration": None}
    if not isinstance(payload, dict):
        return {"changed": False, "manifest": load_extension_manifest(project_root), "migration": None}
    migrated, migration = migrate_extension_manifest_payload(payload)
    if migration is None:
        return {"changed": False, "manifest": migrated, "migration": None}
    backup = path.with_suffix(path.suffix + ".v1.bak")
    if not backup.exists():
        backup.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.write_text(json.dumps(migrated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "changed": True,
        "manifest": migrated,
        "migration": migration,
        "backup_path": str(backup.relative_to(project_root)),
        "manifest_path": EXTENSIONS_MANIFEST,
    }


def ensure_extension_manifest(project_root: Path) -> dict[str, Any]:
    """Create the portable extension manifest if it does not exist."""

    path = manifest_path(project_root)
    if path.exists():
        migration = migrate_extension_manifest_file(project_root)
        return migration["manifest"]
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest = default_manifest()
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    plugins_root = extensions_dir(project_root) / "plugins"
    plugins_root.mkdir(parents=True, exist_ok=True)
    return manifest


def load_extension_manifest(project_root: Path) -> dict[str, Any]:
    path = manifest_path(project_root)
    if not path.exists():
        return default_manifest()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            **default_manifest(),
            "manifest_error": f"invalid extension manifest: {path}",
        }
    if not isinstance(payload, dict):
        return {
            **default_manifest(),
            "manifest_error": f"extension manifest must be an object: {path}",
        }
    migrated, migration = migrate_extension_manifest_payload(payload)
    if migration is not None:
        migrated["migration_required"] = True
    return migrated


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(str(item).strip() for item in value if str(item).strip())


def extension_plugins(project_root: Path) -> list[ExtensionPlugin]:
    manifest = load_extension_manifest(project_root)
    rows = manifest.get("plugins")
    if not isinstance(rows, list):
        return []
    plugins: list[ExtensionPlugin] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        plugin_id = str(row.get("id") or "").strip()
        if not plugin_id:
            continue
        if plugin_id in seen:
            continue
        seen.add(plugin_id)
        config = row.get("config") if isinstance(row.get("config"), dict) else {}
        plugins.append(
            ExtensionPlugin(
                plugin_id=plugin_id,
                version=str(row.get("version") or "0.0.0"),
                enabled=bool(row.get("enabled", False)),
                surfaces=_string_tuple(row.get("surfaces")),
                capabilities=_string_tuple(row.get("capabilities")),
                source=str(row.get("source") or f"plugins/{plugin_id}"),
                config=config,
                title=str(row.get("title") or plugin_id),
                description=str(row.get("description") or ""),
                trusted=bool(row.get("trusted", False)),
            )
        )
    return plugins


def enabled_extension_plugins(project_root: Path) -> list[ExtensionPlugin]:
    return [plugin for plugin in extension_plugins(project_root) if plugin.enabled]


def metrics_plugin_configs(project_root: Path) -> list[dict[str, Any]]:
    configs: list[dict[str, Any]] = []
    for plugin in enabled_extension_plugins(project_root):
        if not plugin.has_metrics:
            continue
        config = dict(plugin.config)
        config.setdefault("plugin_id", plugin.plugin_id)
        config.setdefault("source", plugin.source)
        configs.append(config)
    return configs


def system_plugin_configs(project_root: Path) -> list[dict[str, Any]]:
    configs: list[dict[str, Any]] = []
    for plugin in enabled_extension_plugins(project_root):
        if not plugin.has_system:
            continue
        config = dict(plugin.config)
        config.setdefault("plugin_id", plugin.plugin_id)
        config.setdefault("source", plugin.source)
        configs.append(config)
    return configs


def tool_plugins(project_root: Path) -> list[dict[str, Any]]:
    manifest = load_extension_manifest(project_root)
    builtin = manifest.get("builtin_tools")
    rows = builtin if isinstance(builtin, list) else list(BUILTIN_TOOL_PLUGINS)
    tools: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item = dict(row)
        item.setdefault("kind", "tool")
        item.setdefault("enabled", True)
        tools.append(item)
    for plugin in enabled_extension_plugins(project_root):
        if "tool" not in plugin.capabilities:
            continue
        tools.append(
            {
                "id": plugin.plugin_id,
                "title": plugin.title,
                "kind": "tool",
                "capabilities": list(plugin.capabilities),
                "enabled": True,
                "description": plugin.description,
                "source": plugin.source,
            }
        )
    return tools


def manifest_validation_errors(project_root: Path) -> list[str]:
    manifest = load_extension_manifest(project_root)
    errors: list[str] = []
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        errors.append(f"unsupported schema_version={manifest.get('schema_version')!r}")
    if manifest.get("kind") not in (None, "thoth.extensions"):
        errors.append(f"unsupported kind={manifest.get('kind')!r}")
    rows = manifest.get("plugins")
    if rows is not None and not isinstance(rows, list):
        errors.append("plugins must be a list")
        return errors
    actions = manifest.get("actions")
    if actions is not None and not isinstance(actions, list):
        errors.append("actions must be a list")
    seen: set[str] = set()
    for index, row in enumerate(rows or []):
        if not isinstance(row, dict):
            errors.append(f"plugins[{index}] must be an object")
            continue
        plugin_id = str(row.get("id") or "").strip()
        if not plugin_id:
            errors.append(f"plugins[{index}].id is required")
            continue
        if plugin_id in seen:
            errors.append(f"duplicate plugin id: {plugin_id}")
        seen.add(plugin_id)
        if not isinstance(row.get("config", {}), dict):
            errors.append(f"plugins[{index}].config must be an object")
        source = str(row.get("source") or "").strip()
        if source.startswith("/") or ".." in Path(source).parts:
            errors.append(f"plugins[{index}].source must stay project-relative")
    return errors


def extension_summary(project_root: Path) -> dict[str, Any]:
    plugins = extension_plugins(project_root)
    manifest = load_extension_manifest(project_root)
    validation_errors = manifest_validation_errors(project_root)
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "manifest_path": EXTENSIONS_MANIFEST,
        "manifest_error": manifest.get("manifest_error"),
        "migration_required": bool(manifest.get("migration_required")),
        "last_migration": manifest.get("last_migration"),
        "validation_errors": validation_errors,
        "plugin_count": len(plugins),
        "enabled_plugin_count": len([plugin for plugin in plugins if plugin.enabled]),
        "plugins": [
            {
                "id": plugin.plugin_id,
                "title": plugin.title,
                "version": plugin.version,
                "enabled": plugin.enabled,
                "surfaces": list(plugin.surfaces),
                "capabilities": list(plugin.capabilities),
                "source": plugin.source,
                "trusted": plugin.trusted,
            }
            for plugin in plugins
        ],
        "tool_plugins": tool_plugins(project_root),
        "metrics_configured": bool(metrics_plugin_configs(project_root)),
        "system_configured": bool(system_plugin_configs(project_root)),
        "debug": {
            "manifest_schema_version": manifest.get("schema_version"),
            "plugin_ids": [plugin.plugin_id for plugin in plugins],
            "enabled_plugin_ids": [plugin.plugin_id for plugin in plugins if plugin.enabled],
            "validation_error_count": len(validation_errors),
        },
    }
