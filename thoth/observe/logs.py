"""Run log read helpers for observe surfaces."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from thoth.observe.providers import stamp_provider
from thoth.run.io import _read_json


PHASES = ("plan", "execute", "validate", "reflect")


def _read_events(path: Path, *, limit: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    rows: list[dict[str, Any]] = []
    start_line = max(1, len(lines) - limit + 1)
    for line_no, raw in enumerate(lines[-limit:], start=start_line):
        if not raw.strip():
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"level": "warning", "message": raw, "parse_error": True}
        if isinstance(payload, dict):
            payload.setdefault("seq", payload.get("seq", line_no))
            rows.append(payload)
    return rows


def _event_phase(event: dict[str, Any], fallback: str | None) -> str:
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    phase = event.get("phase") or data.get("phase") or fallback or ""
    return str(phase)


def logs_provider(
    project_root: Path,
    *,
    run_id: str | None = None,
    search: str = "",
    phase: str | None = None,
    limit: int = 200,
    per_run_limit: int = 80,
) -> dict[str, Any]:
    started_epoch = time.time()
    root = project_root.resolve()
    runs_dir = root / ".thoth" / "runs"
    needle = search.strip().lower()
    phase_filter = phase if phase in PHASES else None
    rows: list[dict[str, Any]] = []
    scanned_runs = 0
    if runs_dir.is_dir():
        for run_dir in sorted(runs_dir.iterdir()):
            if not run_dir.is_dir():
                continue
            current_run_id = run_dir.name
            if run_id and current_run_id != run_id:
                continue
            scanned_runs += 1
            state = _read_json(run_dir / "state.json")
            fallback_phase = str(state.get("phase") or "")
            for event in _read_events(run_dir / "events.jsonl", limit=per_run_limit):
                message = str(event.get("message") or "")
                event_phase = _event_phase(event, fallback_phase)
                haystack = " ".join(
                    str(value or "")
                    for value in (
                        current_run_id,
                        event.get("kind"),
                        event.get("level"),
                        event_phase,
                        message,
                    )
                ).lower()
                if needle and needle not in haystack:
                    continue
                if phase_filter and event_phase != phase_filter:
                    continue
                rows.append(
                    {
                        "run_id": current_run_id,
                        "seq": event.get("seq"),
                        "ts": event.get("ts"),
                        "kind": event.get("kind"),
                        "level": event.get("level") or "info",
                        "phase": event_phase,
                        "message": message,
                        "highlight": bool(needle and needle in haystack),
                        "data": event.get("data") if isinstance(event.get("data"), dict) else {},
                    }
                )
    rows.sort(key=lambda row: (str(row.get("ts") or ""), str(row.get("run_id") or ""), int(row.get("seq") or 0)), reverse=True)
    rows = rows[:limit]
    payload = {
        "schema_version": 1,
        "kind": "logs",
        "run_id": run_id,
        "search": search,
        "phase": phase_filter,
        "follow": True,
        "scanned_run_count": scanned_runs,
        "log_count": len(rows),
        "logs": rows,
        "available_phases": list(PHASES),
    }
    return stamp_provider(payload, last_refreshed_epoch=started_epoch)
