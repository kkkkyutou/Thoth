"""Provider cache and background refresh helpers for the TUI."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping

from thoth.observe.extensions import metrics_plugin_configs
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

from .metrics import MetricFileState, summarize_metrics

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
                records.extend(state.tail(max_records=self.metrics_max_records))
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

    def refresh_all_snapshot(self, *, render: bool = True) -> None:
        builders: tuple[tuple[str, ProviderBuilder], ...] = (
            ("project", self._build_project_provider),
            ("authority", self._build_authority_provider),
            ("work_items", self._build_work_items_provider),
            ("runs", self._build_runs_provider),
            ("logs", self._build_logs_provider),
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
