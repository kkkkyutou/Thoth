"""Local TUI preference persistence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


PREFERENCE_SCHEMA_VERSION = 1
PREFERENCE_PATH = ".thoth/local/tui/preferences.json"


DEFAULT_PREFERENCES: dict[str, Any] = {
    "schema_version": PREFERENCE_SCHEMA_VERSION,
    "active_tab": "cockpit",
    "decimal_places": 5,
    "show_smooth": True,
    "log_phase": None,
    "log_follow": True,
}


def preference_path(project_root: str | Path) -> Path:
    return Path(project_root).resolve() / PREFERENCE_PATH


def load_preferences(project_root: str | Path) -> dict[str, Any]:
    path = preference_path(project_root)
    if not path.exists():
        return dict(DEFAULT_PREFERENCES)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_PREFERENCES)
    if not isinstance(payload, dict):
        return dict(DEFAULT_PREFERENCES)
    prefs = dict(DEFAULT_PREFERENCES)
    prefs.update(payload)
    prefs["schema_version"] = PREFERENCE_SCHEMA_VERSION
    return prefs


def save_preferences(project_root: str | Path, preferences: dict[str, Any]) -> Path:
    path = preference_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(DEFAULT_PREFERENCES)
    payload.update({key: value for key, value in preferences.items() if key in DEFAULT_PREFERENCES})
    payload["schema_version"] = PREFERENCE_SCHEMA_VERSION
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path
