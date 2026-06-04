"""Provider cache and background refresh helpers for the TUI."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Mapping

from thoth.observe.experiments import ExperimentFilters, experiment_provider, metrics_for_experiment
from thoth.observe.logs import logs_provider
from thoth.observe.providers import (
    authority_provider,
    plugins_provider,
    project_provider,
    runs_provider,
    stamp_provider,
    system_provider,
    tools_provider,
    work_items_provider,
)

ProviderBuilder = Callable[[], dict[str, Any]]


class TuiProviderRuntimeMixin:
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
        return self._stamp_duration(runs_provider(self.project_root), started)

    def _build_logs_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(logs_provider(self.project_root, limit=300), started)

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

    def _filtered_logs_payload(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        base = dict(payload)
        rows = base.get("logs") if isinstance(base.get("logs"), list) else []
        needle = self.search.lower().strip()
        filtered = []
        for row in rows:
            phase = str(row.get("phase") or "")
            haystack = " ".join(str(row.get(key) or "") for key in ("run_id", "phase", "level", "kind", "message")).lower()
            if self.log_phase and phase != self.log_phase:
                continue
            if needle and needle not in haystack:
                continue
            item = dict(row)
            item["highlight"] = bool(needle and needle in haystack)
            filtered.append(item)
        base["logs"] = filtered
        base["log_count"] = len(filtered)
        base["search"] = self.search
        base["phase"] = self.log_phase
        base["follow"] = self.log_follow
        return base

    def _build_metrics_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        payload = metrics_for_experiment(
            self.project_root,
            max_records=self.metrics_max_records,
            decimal_places=self.decimal_places,
            local_window_steps=self.local_window_steps,
            global_max_points=self.global_max_points,
        )
        return self._stamp_duration(
            stamp_provider(
                payload,
                refresh_seconds=self.metrics_refresh_seconds,
                last_error="; ".join(payload.get("provider_errors") or []) if payload.get("provider_errors") else None,
            ),
            started,
        )

    def _build_experiments_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(experiment_provider(self.project_root, ExperimentFilters(limit=200, offset=0)), started)

    def _build_tools_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(tools_provider(self.project_root), started)

    def _build_plugins_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(plugins_provider(self.project_root), started)

    def _build_system_provider(self) -> dict[str, Any]:
        started = time.perf_counter()
        return self._stamp_duration(system_provider(self.project_root, include_gpu=not self.no_gpu), started)

    def refresh_all_snapshot(self, *, render: bool = True) -> None:
        builders: tuple[tuple[str, ProviderBuilder], ...] = (
            ("project", self._build_project_provider),
            ("authority", self._build_authority_provider),
            ("work_items", self._build_work_items_provider),
            ("runs", self._build_runs_provider),
            ("logs", self._build_logs_provider),
            ("experiments", self._build_experiments_provider),
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
                if key == "logs":
                    self._logs_base = payload
                    payload = self._filtered_logs_payload(payload)
                self.providers[key] = payload
            except Exception as exc:
                self.providers[key] = self._error_payload(key, exc)
        self._plugin_states.update(self._build_plugin_panel_states())
        self.rebuild_snapshot()
        if render:
            self.request_render()

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
        if key == "logs":
            self._logs_base = payload
            payload = self._filtered_logs_payload(payload)
        self.providers[key] = payload
        self.rebuild_snapshot()
        if render:
            self.request_render()

    def refresh_metrics(self) -> None:
        self._refresh_provider_async("metrics", self._build_metrics_provider)

    def refresh_experiments(self) -> None:
        self._refresh_provider_async("experiments", self._build_experiments_provider)

    def refresh_runs(self) -> None:
        self._refresh_provider_async("runs", self._build_runs_provider)
        if self.log_follow:
            self._refresh_provider_async("logs", self._build_logs_provider)

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
