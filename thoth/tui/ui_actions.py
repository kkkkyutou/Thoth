"""Low-latency key actions for the TUI."""

from __future__ import annotations

import threading
from typing import Any, Mapping

from textual.widgets import Input

from thoth.observe.actions import action_catalog, run_observe_action
from thoth.observe.experiments import select_experiment
from thoth.observe.logs import PHASES


class TuiActionsMixin:
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

    def _selected_run_id(self) -> str | None:
        runs = (self.providers.get("runs", {}) or {}).get("runs") or []
        if not runs:
            return None
        index = max(0, min(len(runs) - 1, self.selected_run_index))
        run_id = runs[index].get("run_id") if isinstance(runs[index], Mapping) else None
        return str(run_id) if run_id else None

    def _selected_action(self) -> dict[str, Any] | None:
        actions = action_catalog()
        if not actions:
            return None
        index = max(0, min(len(actions) - 1, self.palette_selected_index))
        return actions[index]

    def _action_target_id(self, action: Mapping[str, Any]) -> str | None:
        return self._selected_run_id() if action.get("target_kind") == "run" else None

    def _run_action_async(self, action_id: str, target_id: str | None) -> None:
        if self.action_inflight:
            return
        self.action_inflight = True
        self.action_result = {
            "schema_version": 1,
            "action_id": action_id,
            "status": "running",
            "summary": "Action is running.",
            "target_id": target_id,
            "body": {},
        }
        self.request_render()

        def target() -> None:
            try:
                result = run_observe_action(self.project_root, action_id, target_id=target_id, confirmed=True)
            except Exception as exc:  # pragma: no cover - surfaced in UI.
                result = {
                    "schema_version": 1,
                    "action_id": action_id,
                    "status": "error",
                    "summary": f"{type(exc).__name__}: {exc}",
                    "target_id": target_id,
                    "body": {},
                }
            self.call_from_thread(self._apply_action_result, result)

        threading.Thread(target=target, name=f"thoth-tui-action-{action_id}", daemon=True).start()

    def _apply_action_result(self, result: dict[str, Any]) -> None:
        self.action_inflight = False
        self.action_result = result
        self.pending_action_id = None
        self.palette_open = False
        if result.get("action_id") == "refresh":
            self.action_refresh()
        elif result.get("action_id") in {"attach", "watch", "stop"}:
            self.refresh_runs()
        self.request_render()

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
        self.experiment_detail = False
        self.show_help = False
        self.palette_open = False
        self.pending_action_id = None
        self._save_preferences()
        self.request_render()

    def action_next_tab(self) -> None:
        index = self.TABS.index(self.active_tab) if self.active_tab in self.TABS else 0
        self.action_show_tab(self.TABS[(index + 1) % len(self.TABS)])

    def action_prev_tab(self) -> None:
        index = self.TABS.index(self.active_tab) if self.active_tab in self.TABS else 0
        self.action_show_tab(self.TABS[(index - 1) % len(self.TABS)])

    def action_next_pane(self) -> None:
        if self.active_tab == "loss":
            series = (self.providers.get("metrics", {}) or {}).get("series") or []
            if series:
                self.selected_series_index = (self.selected_series_index + 1) % len(series)
        self._save_preferences()
        self.request_render()

    def action_prev_pane(self) -> None:
        if self.active_tab == "loss":
            series = (self.providers.get("metrics", {}) or {}).get("series") or []
            if series:
                self.selected_series_index = (self.selected_series_index - 1) % len(series)
        self._save_preferences()
        self.request_render()

    def action_cursor_up(self) -> None:
        if self.palette_open:
            self.palette_selected_index = max(0, self.palette_selected_index - 1)
            self.request_render()
            return
        if self.active_tab == "experiments":
            self.selected_experiment_index = max(0, self.selected_experiment_index - 1)
        elif self.active_tab == "runs":
            self.selected_run_index = max(0, self.selected_run_index - 1)
        elif self.active_tab == "authority":
            self.selected_work_index = max(0, self.selected_work_index - 1)
        elif self.active_tab == "loss":
            self.selected_metric_index = max(0, self.selected_metric_index - 1)
        self.request_render()

    def action_cursor_down(self) -> None:
        if self.palette_open:
            actions = action_catalog()
            self.palette_selected_index = min(max(0, len(actions) - 1), self.palette_selected_index + 1)
            self.request_render()
            return
        if self.active_tab == "experiments":
            rows = (self.providers.get("experiments", {}) or {}).get("experiments") or []
            self.selected_experiment_index = min(max(0, len(rows) - 1), self.selected_experiment_index + 1)
        elif self.active_tab == "runs":
            rows = (self.providers.get("runs", {}) or {}).get("runs") or []
            self.selected_run_index = min(max(0, len(rows) - 1), self.selected_run_index + 1)
        elif self.active_tab == "authority":
            rows = (self.providers.get("work_items", {}) or {}).get("work_items") or []
            self.selected_work_index = min(max(0, len(rows) - 1), self.selected_work_index + 1)
        elif self.active_tab == "loss":
            rows = (self.providers.get("metrics", {}) or {}).get("metrics") or []
            self.selected_metric_index = min(max(0, len(rows) - 1), self.selected_metric_index + 1)
        self.request_render()

    def action_enter_detail(self) -> None:
        if self.palette_open:
            action = self._selected_action()
            if not action:
                return
            action_id = str(action.get("id") or "")
            if not action.get("confirmation_required"):
                self._run_action_async(action_id, self._action_target_id(action))
                return
            if self.pending_action_id != action_id:
                self.pending_action_id = action_id
                preview = run_observe_action(self.project_root, action_id, target_id=self._action_target_id(action), confirmed=False)
                self.action_result = preview
                self.request_render()
                return
            self._run_action_async(action_id, self._action_target_id(action))
            return
        if self.active_tab == "experiments":
            rows = (self.providers.get("experiments", {}) or {}).get("experiments") or []
            if rows:
                index = max(0, min(len(rows) - 1, self.selected_experiment_index))
                experiment_id = rows[index].get("experiment_id")
                if experiment_id:
                    try:
                        select_experiment(self.project_root, str(experiment_id))
                    except Exception as exc:  # pragma: no cover - surfaced as action result.
                        self.action_result = {
                            "schema_version": 1,
                            "action_id": "experiment.select",
                            "status": "error",
                            "summary": f"{type(exc).__name__}: {exc}",
                            "target_id": str(experiment_id),
                            "body": {},
                        }
                    else:
                        experiments = self.providers.get("experiments", {}) if isinstance(self.providers.get("experiments"), dict) else {}
                        if experiments:
                            experiments["selected_experiment_id"] = str(experiment_id)
                            experiments["effective_experiment_id"] = str(experiment_id)
                        self.action_result = {
                            "schema_version": 1,
                            "action_id": "experiment.select",
                            "status": "ok",
                            "summary": f"Selected experiment {experiment_id}. Press r to refresh providers if needed.",
                            "target_id": str(experiment_id),
                            "body": {},
                        }
        elif self.active_tab == "loss":
            self.detail = True
        elif self.active_tab == "runs":
            self.run_detail = True
        self.request_render()

    def action_escape_detail(self) -> None:
        if self.palette_open or self.pending_action_id:
            self.palette_open = False
            self.pending_action_id = None
        elif self.show_help:
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
        if self._logs_base:
            self.providers["logs"] = self._filtered_logs_payload(self._logs_base)
            self.rebuild_snapshot()
            self.request_render()

    def action_toggle_smooth(self) -> None:
        self.show_smooth = not self.show_smooth
        self._save_preferences()
        self.request_render()

    def action_cycle_decimals(self) -> None:
        cycle = [3, 5, 7]
        try:
            index = cycle.index(self.decimal_places)
        except ValueError:
            index = 0
        self.decimal_places = cycle[(index + 1) % len(cycle)]
        self._save_preferences()
        self.request_render()

    def action_toggle_help(self) -> None:
        self.show_help = not self.show_help
        self.palette_open = False
        self.pending_action_id = None
        self.request_render()

    def action_toggle_palette(self) -> None:
        self.palette_open = not self.palette_open
        self.pending_action_id = None
        self.show_help = False
        self.request_render()

    def action_toggle_log_follow(self) -> None:
        self.log_follow = not self.log_follow
        if self._logs_base:
            self.providers["logs"] = self._filtered_logs_payload(self._logs_base)
            self.rebuild_snapshot()
        self._save_preferences()
        self.request_render()

    def action_cycle_log_phase(self) -> None:
        values: list[str | None] = [None, *PHASES]
        try:
            index = values.index(self.log_phase)
        except ValueError:
            index = 0
        self.log_phase = values[(index + 1) % len(values)]
        if self._logs_base:
            self.providers["logs"] = self._filtered_logs_payload(self._logs_base)
            self.rebuild_snapshot()
        self._save_preferences()
        self.request_render()
