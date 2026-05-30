"""Trusted Python TUI plugin runtime."""

from __future__ import annotations

import time
from typing import Any

from rich.panel import Panel

from .plugin_api import load_tui_python_plugins


class TuiPluginRuntimeMixin:
    def _record_plugin_notice(self, plugin_id: str, level: str, message: str, **extra: Any) -> None:
        key = f"{plugin_id}:{level}:{message}"
        if key in self._plugin_warning_keys:
            return
        self._plugin_warning_keys.add(key)
        payload = {"plugin_id": plugin_id, "level": level, "message": message}
        payload.update(extra)
        self._python_plugin_notices.append(payload)

    def refresh_plugin_metadata(self) -> None:
        result = load_tui_python_plugins(self.project_root, no_python_plugins=self.no_python_plugins)
        self._plugin_panels = list(result.panels)
        self._python_plugin_notices = list(result.notices)
        self._plugin_providers.clear()
        self._plugin_renderers.clear()
        self._plugin_states.clear()
        self._plugin_duration_ms.clear()
        self._plugin_degraded.clear()

    def _build_plugin_panel_states(self) -> dict[str, Any]:
        states: dict[str, Any] = {}
        for panel in self._plugin_panels:
            key = f"{panel.plugin_id}:{panel.spec.id}"
            if panel.spec.provider_factory is None:
                continue
            started = time.perf_counter()
            try:
                provider = self._plugin_providers.get(key)
                if provider is None:
                    provider = panel.spec.provider_factory(panel.context)
                    self._plugin_providers[key] = provider
                previous = self._plugin_states.get(key)
                if hasattr(provider, "refresh") and callable(provider.refresh):
                    state = provider.refresh(previous)
                elif callable(provider):
                    state = provider(previous)
                else:
                    state = previous
                self._plugin_states[key] = state
                states[key] = {
                    "schema_version": 1,
                    "plugin_id": panel.plugin_id,
                    "panel_id": panel.spec.id,
                    "title": panel.spec.title,
                    "state": state,
                    "provider": {
                        "last_refreshed_epoch": time.time(),
                        "stale_seconds": 0.0,
                        "duration_ms": round((time.perf_counter() - started) * 1000.0, 3),
                        "last_error": None,
                    },
                }
            except Exception as exc:
                self._record_plugin_notice(panel.plugin_id, "error", f"{key} provider failed: {type(exc).__name__}: {exc}")
        return states

    def _render_plugin_panels(self) -> list[Any]:
        renderables: list[Any] = []
        for panel in self._plugin_panels:
            if panel.spec.renderer_factory is None:
                continue
            key = f"{panel.plugin_id}:{panel.spec.id}"
            try:
                renderer = self._plugin_renderers.get(key)
                if renderer is None:
                    renderer = panel.spec.renderer_factory(panel.context)
                    self._plugin_renderers[key] = renderer
                started = time.perf_counter()
                renderable = renderer.render(
                    self._plugin_states.get(key),
                    {
                        "active_tab": self.active_tab,
                        "search": self.search,
                        "decimal_places": self.decimal_places,
                        "show_smooth": self.show_smooth,
                    },
                    None,
                )
                duration_ms = (time.perf_counter() - started) * 1000.0
                self._plugin_duration_ms[key] = round(duration_ms, 3)
                if duration_ms > float(panel.spec.render_budget_ms):
                    self._record_plugin_notice(panel.plugin_id, "warning", f"{key} renderer exceeded budget: {duration_ms:.1f}ms")
                    if panel.spec.degrade_on_budget_exceeded:
                        self._plugin_degraded.add(key)
                        renderables.append(Panel(f"{key} renderer degraded after {duration_ms:.1f}ms.", title=panel.spec.title))
                        continue
                self._plugin_degraded.discard(key)
                if renderable is not None:
                    renderables.append(renderable)
            except Exception as exc:
                self._plugin_degraded.add(key)
                self._record_plugin_notice(panel.plugin_id, "error", f"{key} renderer failed: {type(exc).__name__}: {exc}")
                renderables.append(Panel(f"{key} renderer failed: {type(exc).__name__}: {exc}", title=panel.spec.title))
        return renderables
