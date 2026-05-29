"""Textual application for the Thoth TUI."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container
from textual.widgets import Footer, Header, Input, Static, TabPane, TabbedContent

from thoth.observe.extensions import metrics_plugin_configs
from thoth.observe.providers import (
    authority_provider,
    plugins_provider,
    project_provider,
    runs_provider,
    stamp_provider,
    system_provider,
    tools_provider,
    utc_now,
    work_items_provider,
)

from .metrics import DEFAULT_GLOBAL_MAX_POINTS, DEFAULT_LOCAL_WINDOW_STEPS, MetricFileState, summarize_metrics
from .plugin_api import LoadedTuiPanel, load_tui_python_plugins
from .render import TABS, tab_renderable


CSS = """
Screen {
    background: #080607;
    color: #f7f1e8;
}
#root {
    height: 1fr;
}
#search {
    dock: top;
    height: 3;
    border: round #d21f3c;
    background: #120b0b;
    color: #f7f1e8;
}
#view {
    height: 1fr;
    background: #080607;
}
.thoth-pane {
    height: 1fr;
    overflow-y: auto;
    padding: 1;
}
"""


ProviderBuilder = Callable[[], dict[str, Any]]


class ThothTuiApp(App[None]):
    CSS = CSS
    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
        Binding("tab", "next_tab", "Next", priority=True),
        Binding("shift+tab", "prev_tab", "Prev", priority=True),
        Binding("up", "cursor_up", "Up", priority=True),
        Binding("down", "cursor_down", "Down", priority=True),
        Binding("enter", "enter_detail", "Detail", priority=True),
        Binding("escape", "escape_detail", "Back", priority=True),
        Binding("/", "focus_search", "Search", priority=True),
        Binding("s", "toggle_smooth", "EMA", priority=True),
        Binding("d", "cycle_decimals", "Decimals", priority=True),
        Binding("?", "toggle_help", "Help", priority=True),
        Binding("1", "show_tab('loss')", "Loss"),
        Binding("2", "show_tab('runs')", "Runs"),
        Binding("3", "show_tab('authority')", "Authority"),
        Binding("4", "show_tab('gpu')", "GPU"),
        Binding("5", "show_tab('plugins')", "Plugins"),
    ]

    def __init__(
        self,
        *,
        project_root: str | Path,
        no_gpu: bool,
        refresh_seconds: float,
        metrics_refresh_seconds: float | None = None,
        runs_refresh_seconds: float | None = None,
        gpu_refresh_seconds: float | None = None,
        ui_frame_seconds: float | None = None,
        metrics_max_records: int,
        no_python_plugins: bool = False,
        local_window_steps: int = DEFAULT_LOCAL_WINDOW_STEPS,
        global_max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
        decimal_places: int = 5,
    ) -> None:
        super().__init__()
        self.project_root = Path(project_root).resolve()
        self.no_gpu = no_gpu
        self.refresh_seconds = refresh_seconds
        self.metrics_refresh_seconds = metrics_refresh_seconds or refresh_seconds
        self.runs_refresh_seconds = runs_refresh_seconds or refresh_seconds
        self.gpu_refresh_seconds = gpu_refresh_seconds or refresh_seconds
        self.ui_frame_seconds = ui_frame_seconds or 0.06
        self.metrics_max_records = metrics_max_records
        self.no_python_plugins = no_python_plugins
        self.local_window_steps = local_window_steps
        self.global_max_points = global_max_points
        self.decimal_places = decimal_places

        self.active_tab = "loss"
        self.selected_metric_index = 0
        self.selected_run_index = 0
        self.selected_work_index = 0
        self.detail = False
        self.run_detail = False
        self.show_smooth = True
        self.show_help = False
        self.search = ""

        self.providers: dict[str, dict[str, Any]] = {}
        self.gpu: dict[str, Any] = {}
        self.snapshot: dict[str, Any] = {}
        self._runs_base: dict[str, Any] = {}
        self._metric_states: dict[Path, MetricFileState] = {}
        self._render_pending = False
        self._provider_inflight: set[str] = set()
        self._provider_lock = threading.Lock()

        self._plugin_panels: list[LoadedTuiPanel] = []
        self._plugin_providers: dict[str, Any] = {}
        self._plugin_renderers: dict[str, Any] = {}
        self._plugin_states: dict[str, Any] = {}
        self._plugin_duration_ms: dict[str, float] = {}
        self._plugin_warning_keys: set[str] = set()
        self._python_plugin_notices: list[dict[str, Any]] = []

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Input(placeholder="filter runs by id/work/status/phase", id="search")
        with Container(id="root"):
            with TabbedContent(initial="loss"):
                with TabPane("Loss / Metrics", id="loss"):
                    yield Static(id="loss-view", classes="thoth-pane")
                with TabPane("Runs", id="runs"):
                    yield Static(id="runs-view", classes="thoth-pane")
                with TabPane("Authority / Work", id="authority"):
                    yield Static(id="authority-view", classes="thoth-pane")
                with TabPane("GPU", id="gpu"):
                    yield Static(id="gpu-view", classes="thoth-pane")
                with TabPane("Plugins / Errors", id="plugins"):
                    yield Static(id="plugins-view", classes="thoth-pane")
        yield Footer()

    def on_mount(self) -> None:
        self._hide_search()
        self.refresh_plugin_metadata()
        self.refresh_all_snapshot(render=False)
        self.render_cached_snapshot()
        if self.metrics_refresh_seconds > 0:
            self.set_interval(self.metrics_refresh_seconds, self.refresh_metrics)
        if self.runs_refresh_seconds > 0:
            self.set_interval(self.runs_refresh_seconds, self.refresh_runs)
        if self.refresh_seconds > 0:
            self.set_interval(self.refresh_seconds, self.refresh_authority)
        if self.gpu_refresh_seconds > 0 and not self.no_gpu:
            self.set_interval(self.gpu_refresh_seconds, self.refresh_gpu)
        if self.refresh_seconds > 0:
            self.set_interval(max(self.refresh_seconds, 2.0), self.refresh_plugins)

    def _stamp_duration(self, payload: dict[str, Any], started: float) -> dict[str, Any]:
        provider = payload.get("provider") if isinstance(payload.get("provider"), dict) else {}
        provider["duration_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
        payload["provider"] = provider
        return payload

    def _error_payload(self, kind: str, exc: BaseException, *, refresh_seconds: float | None = None) -> dict[str, Any]:
        return stamp_provider(
            {"schema_version": 1, "kind": kind, "degraded": True, "provider_errors": [f"{type(exc).__name__}: {exc}"]},
            refresh_seconds=refresh_seconds,
            last_error=f"{type(exc).__name__}: {exc}",
        )

    def _build_project_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(project_provider(self.project_root), started)

    def _build_authority_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(authority_provider(self.project_root), started)

    def _build_work_items_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(work_items_provider(self.project_root), started)

    def _build_runs_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        payload = runs_provider(self.project_root)
        return self._stamp_duration(payload, started)

    def _filtered_runs_payload(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        base = dict(payload)
        rows = base.get("runs") if isinstance(base.get("runs"), list) else []
        if self.search:
            needle = self.search.lower()
            rows = [
                row
                for row in rows
                if needle
                in " ".join(
                    str(row.get(key) or "") for key in ("run_id", "work_id", "status", "phase", "title", "latest_message")
                ).lower()
            ]
        base["runs"] = list(rows)
        base["run_count"] = len(rows)
        base["search"] = self.search
        return base

    def _build_metrics_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        configs = metrics_plugin_configs(self.project_root)
        if not configs:
            return self._stamp_duration(
                stamp_provider(
                    {
                        "schema_version": 1,
                        "kind": "metrics",
                        "configured": False,
                        "metrics": [],
                        "message": "No metrics provider configured. Add a metrics-capable plugin in .thoth/extensions/manifest.json.",
                    },
                    refresh_seconds=self.metrics_refresh_seconds,
                ),
                started,
            )
        records = []
        bad_lines = 0
        source_files: list[str] = []
        provider_errors: list[str] = []
        run_name = None
        active_paths: set[Path] = set()
        for config in configs:
            if run_name is None and isinstance(config.get("run_name"), str):
                run_name = str(config.get("run_name"))
            files = config.get("metrics_files")
            if isinstance(files, str):
                files = [files]
            if not isinstance(files, list):
                provider_errors.append(f"{config.get('plugin_id', 'plugin')}: config.metrics_files must be a list or string")
                continue
            for item in files:
                if not isinstance(item, str) or not item.strip():
                    continue
                path = Path(item)
                if not path.is_absolute():
                    path = self.project_root / path
                path = path.resolve()
                active_paths.add(path)
                source_files.append(str(path))
                if not path.exists():
                    provider_errors.append(f"missing metrics file: {path}")
                    continue
                state = self._metric_states.get(path)
                if state is None:
                    state = MetricFileState(path)
                    self._metric_states[path] = state
                next_records = state.tail(max_records=self.metrics_max_records)
                records.extend(next_records)
                bad_lines += state.bad_lines
                if state.last_error:
                    provider_errors.append(state.last_error)
        for stale_path in set(self._metric_states) - active_paths:
            self._metric_states.pop(stale_path, None)
        payload = summarize_metrics(
            records,
            run_name=run_name,
            decimal_places=self.decimal_places,
            local_window_steps=self.local_window_steps,
            global_max_points=self.global_max_points,
        )
        payload.update(
            {
                "configured": True,
                "configs": configs,
                "source_files": source_files,
                "bad_lines": bad_lines,
                "provider_errors": provider_errors,
                "message": "Metrics providers are configured through project extensions.",
            }
        )
        return self._stamp_duration(
            stamp_provider(
                payload,
                refresh_seconds=self.metrics_refresh_seconds,
                last_error="; ".join(provider_errors) if provider_errors else None,
            ),
            started,
        )

    def _build_tools_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(tools_provider(self.project_root), started)

    def _build_plugins_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(plugins_provider(self.project_root), started)

    def _build_system_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(system_provider(self.project_root, include_gpu=not self.no_gpu), started)

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

    def refresh_all_snapshot(self, *, render: bool = True) -> None:
        builders: tuple[tuple[str, ProviderBuilder], ...] = (
            ("project", self._build_project_provider),
            ("authority", self._build_authority_provider),
            ("work_items", self._build_work_items_provider),
            ("runs", self._build_runs_provider),
            ("metrics", self._build_metrics_provider),
            ("plugins", self._build_plugins_provider),
            ("tools", self._build_tools_provider),
            ("system", self._build_system_provider),
        )
        for key, builder in builders:
            try:
                payload = builder()
                if key == "runs":
                    self._runs_base = payload
                    payload = self._filtered_runs_payload(payload)
                self.providers[key] = payload
            except Exception as exc:
                self.providers[key] = self._error_payload(key, exc)
        self._plugin_states.update(self._build_plugin_panel_states())
        self.rebuild_snapshot()
        if render:
            self.request_render()

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
        self.gpu = stamp_provider(shared_gpu or {"schema_version": 1, "kind": "gpu", "available": False, "reason": "no gpu data", "gpus": []}, refresh_seconds=None)
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
                "no_python_plugins": self.no_python_plugins,
                "local_window_steps": self.local_window_steps,
                "global_max_points": self.global_max_points,
                "decimal_places": self.decimal_places,
                "python_plugin_notices": self._python_plugin_notices,
                "python_plugin_panels": [
                    {
                        "plugin_id": panel.plugin_id,
                        "panel_id": panel.spec.id,
                        "title": panel.spec.title,
                        "refresh_seconds": panel.spec.refresh_seconds,
                        "render_budget_ms": panel.spec.render_budget_ms,
                        "provider_duration_ms": (self._plugin_states.get(f"{panel.plugin_id}:{panel.spec.id}") or {}).get("provider", {}).get("duration_ms"),
                        "renderer_duration_ms": self._plugin_duration_ms.get(f"{panel.plugin_id}:{panel.spec.id}"),
                    }
                    for panel in self._plugin_panels
                ],
                "renderer_executed": True,
            },
        }

    def _refresh_provider_async(self, key: str, builder: ProviderBuilder, *, render: bool = True) -> None:
        with self._provider_lock:
            if key in self._provider_inflight:
                return
            self._provider_inflight.add(key)

        def target() -> None:
            try:
                payload = builder()
                error: BaseException | None = None
            except Exception as exc:  # pragma: no cover - surfaced in UI.
                payload = self._error_payload(key, exc)
                error = exc
            try:
                self.call_from_thread(self._apply_provider_payload, key, payload, render)
            finally:
                with self._provider_lock:
                    self._provider_inflight.discard(key)
            if error is not None:
                return

        threading.Thread(target=target, name=f"thoth-tui-{key}", daemon=True).start()

    def _apply_provider_payload(self, key: str, payload: dict[str, Any], render: bool = True) -> None:
        if key == "runs":
            self._runs_base = payload
            payload = self._filtered_runs_payload(payload)
        self.providers[key] = payload
        self.rebuild_snapshot()
        if render:
            self.request_render()

    def refresh_metrics(self) -> None:
        self._refresh_provider_async("metrics", self._build_metrics_provider)

    def refresh_runs(self) -> None:
        self._refresh_provider_async("runs", self._build_runs_provider)

    def refresh_authority(self) -> None:
        self._refresh_provider_async("authority", self._build_authority_provider)
        self._refresh_provider_async("work_items", self._build_work_items_provider)

    def refresh_gpu(self) -> None:
        self._refresh_provider_async("system", self._build_system_provider)

    def refresh_plugins(self) -> None:
        self.refresh_plugin_metadata()
        self._refresh_provider_async("plugins", self._build_plugins_provider)
        self._refresh_provider_async("tools", self._build_tools_provider)
        self._plugin_states.update(self._build_plugin_panel_states())
        self.rebuild_snapshot()
        self.request_render()

    def request_render(self) -> None:
        if self._render_pending:
            return
        self._render_pending = True
        self.set_timer(self.ui_frame_seconds, self.flush_render)

    def flush_render(self) -> None:
        self._render_pending = False
        self.render_cached_snapshot()

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
                if renderable is not None:
                    renderables.append(renderable)
            except Exception as exc:
                self._record_plugin_notice(panel.plugin_id, "error", f"{key} renderer failed: {type(exc).__name__}: {exc}")
        return renderables

    def render_cached_snapshot(self) -> None:
        if not self.snapshot:
            return
        self.rebuild_snapshot()
        plugin_renderables = self._render_plugin_panels() if self.active_tab == "plugins" else []
        self.query_one("#loss-view", Static).update(
            tab_renderable(
                self.snapshot,
                "loss",
                selected_metric_index=self.selected_metric_index,
                detail=self.detail,
                show_smooth=self.show_smooth,
                show_help=self.show_help and self.active_tab == "loss",
                decimal_places=self.decimal_places,
            )
        )
        self.query_one("#runs-view", Static).update(
            tab_renderable(
                self.snapshot,
                "runs",
                selected_run_index=self.selected_run_index,
                run_detail=self.run_detail,
                show_help=self.show_help and self.active_tab == "runs",
                decimal_places=self.decimal_places,
            )
        )
        self.query_one("#authority-view", Static).update(
            tab_renderable(
                self.snapshot,
                "authority",
                selected_work_index=self.selected_work_index,
                show_help=self.show_help and self.active_tab == "authority",
                decimal_places=self.decimal_places,
            )
        )
        self.query_one("#gpu-view", Static).update(
            tab_renderable(self.snapshot, "gpu", show_help=self.show_help and self.active_tab == "gpu", decimal_places=self.decimal_places)
        )
        self.query_one("#plugins-view", Static).update(
            tab_renderable(
                self.snapshot,
                "plugins",
                show_help=self.show_help and self.active_tab == "plugins",
                decimal_places=self.decimal_places,
                plugin_renderables=plugin_renderables,
            )
        )

    def _hide_search(self) -> None:
        try:
            search = self.query_one("#search", Input)
        except Exception:
            return
        search.display = False
        search.disabled = True

    def _show_search(self) -> None:
        try:
            search = self.query_one("#search", Input)
        except Exception:
            return
        search.disabled = False
        search.display = True
        search.focus()

    def _set_active_tab(self, tab_id: str) -> None:
        if tab_id not in TABS:
            return
        self.active_tab = tab_id
        try:
            self.query_one(TabbedContent).active = tab_id
        except Exception:
            pass

    def action_refresh(self) -> None:
        self.refresh_metrics()
        self.refresh_runs()
        self.refresh_authority()
        self.refresh_plugins()
        if not self.no_gpu:
            self.refresh_gpu()

    def action_show_tab(self, tab_id: str) -> None:
        self._set_active_tab(tab_id)
        self.detail = False
        self.run_detail = False
        self.show_help = False
        self.request_render()

    def action_next_tab(self) -> None:
        index = TABS.index(self.active_tab) if self.active_tab in TABS else 0
        self.action_show_tab(TABS[(index + 1) % len(TABS)])

    def action_prev_tab(self) -> None:
        index = TABS.index(self.active_tab) if self.active_tab in TABS else 0
        self.action_show_tab(TABS[(index - 1) % len(TABS)])

    def action_cursor_up(self) -> None:
        if self.active_tab == "runs":
            self.selected_run_index = max(0, self.selected_run_index - 1)
        elif self.active_tab == "authority":
            self.selected_work_index = max(0, self.selected_work_index - 1)
        else:
            self.selected_metric_index = max(0, self.selected_metric_index - 1)
        self.request_render()

    def action_cursor_down(self) -> None:
        if self.active_tab == "runs":
            rows = (self.providers.get("runs", {}) or {}).get("runs") or []
            self.selected_run_index = min(max(0, len(rows) - 1), self.selected_run_index + 1)
        elif self.active_tab == "authority":
            rows = (self.providers.get("work_items", {}) or {}).get("work_items") or []
            self.selected_work_index = min(max(0, len(rows) - 1), self.selected_work_index + 1)
        else:
            rows = (self.providers.get("metrics", {}) or {}).get("metrics") or []
            self.selected_metric_index = min(max(0, len(rows) - 1), self.selected_metric_index + 1)
        self.request_render()

    def action_enter_detail(self) -> None:
        if self.active_tab == "loss":
            self.detail = True
        elif self.active_tab == "runs":
            self.run_detail = True
        self.request_render()

    def action_escape_detail(self) -> None:
        if self.show_help:
            self.show_help = False
        elif self.detail:
            self.detail = False
        elif self.run_detail:
            self.run_detail = False
        self._hide_search()
        try:
            self.set_focus(None)
        except Exception:
            pass
        self.request_render()

    def action_focus_search(self) -> None:
        self._show_search()
        self.request_render()

    def on_input_changed(self, event: Input.Changed) -> None:
        self.search = event.value
        if self._runs_base:
            self.providers["runs"] = self._filtered_runs_payload(self._runs_base)
            self.rebuild_snapshot()
            self.request_render()

    def action_toggle_smooth(self) -> None:
        self.show_smooth = not self.show_smooth
        self.request_render()

    def action_cycle_decimals(self) -> None:
        cycle = [3, 5, 7]
        try:
            index = cycle.index(self.decimal_places)
        except ValueError:
            index = 0
        self.decimal_places = cycle[(index + 1) % len(cycle)]
        self.request_render()

    def action_toggle_help(self) -> None:
        self.show_help = not self.show_help
        self.request_render()
