"""Textual application shell for the Thoth TUI."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container
from textual.widgets import Footer, Header, Input, Static

from thoth.observe.logs import PHASES

from .metrics import DEFAULT_GLOBAL_MAX_POINTS, DEFAULT_LOCAL_WINDOW_STEPS, MetricFileState
from .plugin_api import LoadedTuiPanel
from .plugin_runtime import TuiPluginRuntimeMixin
from .preferences import load_preferences
from .provider_runtime import TuiProviderRuntimeMixin
from .render import TABS, tab_renderable
from .state_runtime import TuiStateMixin
from .ui_actions import TuiActionsMixin


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


class ThothTuiApp(
    TuiActionsMixin,
    TuiProviderRuntimeMixin,
    TuiPluginRuntimeMixin,
    TuiStateMixin,
    App[None],
):
    CSS = CSS
    TABS = TABS
    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
        Binding("right", "next_tab", "Next View", priority=True),
        Binding("left", "prev_tab", "Prev View", priority=True),
        Binding("tab", "next_pane", "Next Pane", priority=True),
        Binding("shift+tab", "prev_pane", "Prev Pane", priority=True),
        Binding("up", "cursor_up", "Up", priority=True),
        Binding("down", "cursor_down", "Down", priority=True),
        Binding("enter", "enter_detail", "Detail", priority=True),
        Binding("escape", "escape_detail", "Back", priority=True),
        Binding("/", "focus_search", "Search", priority=True),
        Binding("s", "toggle_smooth", "EMA", priority=True),
        Binding("d", "cycle_decimals", "Decimals", priority=True),
        Binding("?", "toggle_help", "Help", priority=True),
        Binding("p", "toggle_palette", "Palette", priority=True),
        Binding("ctrl+p", "toggle_palette", "Palette", priority=True),
        Binding("f", "toggle_log_follow", "Follow", priority=True),
        Binding("v", "cycle_log_phase", "Phase", priority=True),
        Binding("1", "show_tab('experiments')", "Experiments"),
        Binding("2", "show_tab('loss')", "Loss"),
        Binding("3", "show_tab('runs')", "Runs"),
        Binding("4", "show_tab('logs')", "Logs"),
        Binding("5", "show_tab('authority')", "Authority"),
        Binding("6", "show_tab('gpu')", "GPU"),
        Binding("7", "show_tab('extensions')", "Extensions"),
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
        self.preferences = load_preferences(self.project_root)

        preferred_tab = str(self.preferences.get("active_tab") or "experiments")
        if preferred_tab == "cockpit":
            preferred_tab = "experiments"
        if preferred_tab == "plugins":
            preferred_tab = "extensions"
        self.active_tab = preferred_tab if preferred_tab in TABS else "experiments"
        self.selected_experiment_index = int(self.preferences.get("selected_experiment_index") or 0) if isinstance(self.preferences.get("selected_experiment_index"), int) else 0
        self.selected_series_index = int(self.preferences.get("selected_series_index") or 0) if isinstance(self.preferences.get("selected_series_index"), int) else 0
        self.selected_metric_index = 0
        self.selected_run_index = 0
        self.selected_work_index = 0
        self.detail = False
        self.run_detail = False
        self.experiment_detail = False
        self.show_smooth = bool(self.preferences.get("show_smooth", True))
        self.show_help = False
        self.search = ""
        self.log_phase = self.preferences.get("log_phase") if self.preferences.get("log_phase") in PHASES else None
        self.log_follow = bool(self.preferences.get("log_follow", True))
        self.palette_open = False
        self.palette_selected_index = 0
        self.pending_action_id: str | None = None
        self.action_result: dict[str, Any] | None = None
        self.action_inflight = False

        self.providers: dict[str, dict[str, Any]] = {}
        self.gpu: dict[str, Any] = {}
        self.snapshot: dict[str, Any] = {}
        self._runs_base: dict[str, Any] = {}
        self._logs_base: dict[str, Any] = {}
        self._metric_states: dict[Path, MetricFileState] = {}
        self._render_pending = False
        self._provider_inflight: set[str] = set()
        self._provider_lock = threading.Lock()

        self._plugin_panels: list[LoadedTuiPanel] = []
        self._plugin_providers: dict[str, Any] = {}
        self._plugin_renderers: dict[str, Any] = {}
        self._plugin_states: dict[str, Any] = {}
        self._plugin_duration_ms: dict[str, float] = {}
        self._plugin_degraded: set[str] = set()
        self._plugin_warning_keys: set[str] = set()
        self._python_plugin_notices: list[dict[str, Any]] = []
        if isinstance(self.preferences.get("decimal_places"), int):
            self.decimal_places = int(self.preferences.get("decimal_places"))

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Input(placeholder="filter runs/logs by id/work/status/phase/message", id="search")
        with Container(id="root"):
            yield Static(id="view", classes="thoth-pane")
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

    def request_render(self) -> None:
        if self._render_pending:
            return
        self._render_pending = True
        self.set_timer(self.ui_frame_seconds, self.flush_render)

    def flush_render(self) -> None:
        self._render_pending = False
        self.render_cached_snapshot()

    def render_cached_snapshot(self) -> None:
        if not self.snapshot:
            return
        self.rebuild_snapshot()
        plugin_renderables = self._render_plugin_panels() if self.active_tab == "extensions" else []
        common = {
            "palette_open": self.palette_open,
            "palette_selected_index": self.palette_selected_index,
            "pending_action_id": self.pending_action_id,
            "action_result": self.action_result,
            "layout_mode": self._layout_mode(),
            "selected_run_id": self._selected_run_id(),
        }
        selected_work_or_experiment = self.selected_experiment_index if self.active_tab == "experiments" else self.selected_work_index
        self.query_one("#view", Static).update(
            tab_renderable(
                self.snapshot,
                self.active_tab,
                selected_metric_index=self.selected_metric_index,
                selected_run_index=self.selected_run_index,
                selected_work_index=selected_work_or_experiment,
                detail=self.detail,
                run_detail=self.run_detail,
                show_help=self.show_help,
                decimal_places=self.decimal_places,
                plugin_renderables=plugin_renderables,
                **common,
            )
        )
