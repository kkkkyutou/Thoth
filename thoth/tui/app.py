"""Textual application for the Thoth TUI."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widgets import Footer, Header, Static, TabPane, TabbedContent

from .render import tab_renderable
from .snapshot import build_snapshot


CSS = """
Screen {
    background: #080607;
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


class ThothTuiApp(App[None]):
    CSS = CSS
    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
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
    ) -> None:
        super().__init__()
        self.project_root = Path(project_root)
        self.no_gpu = no_gpu
        self.refresh_seconds = refresh_seconds
        self.metrics_refresh_seconds = metrics_refresh_seconds or refresh_seconds
        self.runs_refresh_seconds = runs_refresh_seconds or refresh_seconds
        self.gpu_refresh_seconds = gpu_refresh_seconds or refresh_seconds
        self.ui_frame_seconds = ui_frame_seconds or 0.5
        self.metrics_max_records = metrics_max_records
        self.snapshot: dict[str, Any] = {}

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
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
        self.refresh_snapshot()
        self.render_cached_snapshot()
        if self.metrics_refresh_seconds > 0:
            self.set_interval(self.metrics_refresh_seconds, self.refresh_metrics)
        if self.runs_refresh_seconds > 0:
            self.set_interval(self.runs_refresh_seconds, self.refresh_runs)
        if self.gpu_refresh_seconds > 0 and not self.no_gpu:
            self.set_interval(self.gpu_refresh_seconds, self.refresh_gpu)
        if self.ui_frame_seconds > 0:
            self.set_interval(self.ui_frame_seconds, self.render_cached_snapshot)

    def refresh_snapshot(self) -> None:
        self.snapshot = build_snapshot(
            project_root=self.project_root,
            no_gpu=self.no_gpu,
            metrics_max_records=self.metrics_max_records,
        )
        self.render_cached_snapshot()

    def refresh_metrics(self) -> None:
        self.refresh_snapshot()

    def refresh_runs(self) -> None:
        self.refresh_snapshot()

    def refresh_gpu(self) -> None:
        self.refresh_snapshot()

    def render_cached_snapshot(self) -> None:
        if not self.snapshot:
            return
        self.query_one("#loss-view", Static).update(tab_renderable(self.snapshot, "loss"))
        self.query_one("#runs-view", Static).update(tab_renderable(self.snapshot, "runs"))
        self.query_one("#authority-view", Static).update(tab_renderable(self.snapshot, "authority"))
        self.query_one("#gpu-view", Static).update(tab_renderable(self.snapshot, "gpu"))
        self.query_one("#plugins-view", Static).update(tab_renderable(self.snapshot, "plugins"))

    def action_refresh(self) -> None:
        self.refresh_snapshot()

    def action_show_tab(self, tab_id: str) -> None:
        tabs = self.query_one(TabbedContent)
        tabs.active = tab_id
