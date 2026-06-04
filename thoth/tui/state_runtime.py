"""TUI state and snapshot helpers."""

from __future__ import annotations

import time
from typing import Any

from thoth.observe.actions import action_catalog
from thoth.observe.providers import stamp_provider, utc_now

from .preferences import PREFERENCE_PATH, save_preferences
from .render import TABS


class TuiStateMixin:
    def _layout_mode(self) -> str:
        try:
            width = int(self.size.width)
        except Exception:
            width = 120
        if width < 90:
            return "compact"
        if width < 140:
            return "balanced"
        return "wide"

    def _current_preferences(self) -> dict[str, Any]:
        return {
            "active_tab": self.active_tab,
            "selected_experiment_index": getattr(self, "selected_experiment_index", 0),
            "selected_series_index": getattr(self, "selected_series_index", 0),
            "decimal_places": self.decimal_places,
            "show_smooth": self.show_smooth,
            "log_phase": self.log_phase,
            "log_follow": self.log_follow,
        }

    def _save_preferences(self) -> None:
        try:
            self.preferences = self._current_preferences()
            save_preferences(self.project_root, self.preferences)
        except Exception as exc:
            self._record_plugin_notice("tui", "warning", f"preferences save failed: {type(exc).__name__}: {exc}")

    def rebuild_snapshot(self) -> None:
        now = time.time()
        for payload in list(self.providers.values()) + [self.gpu]:
            provider = payload.get("provider") if isinstance(payload, dict) else None
            if not isinstance(provider, dict):
                continue
            epoch = provider.get("last_refreshed_epoch")
            if isinstance(epoch, (int, float)):
                provider["stale_seconds"] = max(0.0, now - float(epoch))
        system = self.providers.get("system", {})
        shared_gpu = system.get("gpu") if isinstance(system.get("gpu"), dict) else {}
        self.gpu = stamp_provider(
            shared_gpu
            or {"schema_version": 1, "kind": "gpu", "available": False, "reason": "no gpu data", "gpus": []},
            refresh_seconds=None,
        )
        self.snapshot = {
            "schema_version": 1,
            "generated_at": utc_now(),
            "project_root": str(self.project_root),
            "providers": self.providers,
            "overview": {},
            "metrics": self.providers.get("metrics", {}),
            "gpu": self.gpu,
            "tui": {
                "schema_version": 1,
                "surface_version": 3,
                "layout": self._layout_mode(),
                "no_python_plugins": self.no_python_plugins,
                "local_window_steps": self.local_window_steps,
                "global_max_points": self.global_max_points,
                "decimal_places": self.decimal_places,
                "preferences_path": PREFERENCE_PATH,
                "preferences": self._current_preferences(),
                "actions": action_catalog(),
                "palette_open": self.palette_open,
                "pending_action_id": self.pending_action_id,
                "action_inflight": self.action_inflight,
                "python_plugin_notices": self._python_plugin_notices,
                "python_plugin_panels": [
                    {
                        "plugin_id": panel.plugin_id,
                        "panel_id": panel.spec.id,
                        "title": panel.spec.title,
                        "api_version": panel.spec.api_version,
                        "refresh_seconds": panel.spec.refresh_seconds,
                        "render_budget_ms": panel.spec.render_budget_ms,
                        "provider_duration_ms": (
                            self._plugin_states.get(f"{panel.plugin_id}:{panel.spec.id}") or {}
                        ).get("provider", {}).get("duration_ms"),
                        "renderer_duration_ms": self._plugin_duration_ms.get(f"{panel.plugin_id}:{panel.spec.id}"),
                        "renderer_degraded": f"{panel.plugin_id}:{panel.spec.id}" in getattr(self, "_plugin_degraded", set()),
                    }
                    for panel in self._plugin_panels
                ],
                "renderer_executed": True,
            },
        }

    def _set_active_tab(self, tab_id: str) -> None:
        if tab_id not in TABS:
            return
        self.active_tab = tab_id
