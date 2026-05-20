"""Tests for the run-ledger loader used by the dashboard."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))

from runtime_loader import (
    get_active_run_for_work_item,
    get_latest_run_for_work_item,
    get_run_events,
    get_run_worker_logs,
    get_work_item_runs,
    runtime_overview,
)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def test_runtime_overview_reads_active_and_history_runs(tmp_path, monkeypatch):
    project_root = tmp_path
    runs_dir = project_root / ".thoth" / "runs"
    monkeypatch.setenv("THOTH_RUNS_DIR", str(runs_dir))
    monkeypatch.setenv("THOTH_HEARTBEAT_STALE_MINUTES", "100000")

    _write_json(runs_dir / "run-a" / "run.json", {"run_id": "run-a", "work_id": "work-1", "executor": "claude", "created_at": "2026-04-23T10:00:00Z"})
    _write_json(runs_dir / "run-a" / "state.json", {"status": "running", "phase": "experiment", "progress_pct": 52, "last_event_seq": 2, "updated_at": "2026-04-23T10:15:00Z", "last_heartbeat_at": "2026-04-23T10:16:00Z"})
    _write_jsonl(runs_dir / "run-a" / "events.jsonl", [
        {"seq": 1, "ts": "2026-04-23T10:01:00Z", "kind": "log", "message": "boot"},
        {"seq": 2, "ts": "2026-04-23T10:15:00Z", "kind": "log", "message": "step 520"},
    ])

    _write_json(runs_dir / "run-b" / "run.json", {"run_id": "run-b", "work_id": "work-1", "executor": "codex", "created_at": "2026-04-22T10:00:00Z"})
    _write_json(runs_dir / "run-b" / "state.json", {"status": "completed", "phase": "conclusion", "progress_pct": 100, "updated_at": "2026-04-22T11:00:00Z"})
    _write_jsonl(runs_dir / "run-b" / "events.jsonl", [
        {"seq": 1, "ts": "2026-04-22T10:30:00Z", "kind": "summary", "message": "done"},
    ])

    overview = runtime_overview(project_root)
    assert overview["active_run_count"] == 1
    assert overview["last_runtime_update"] == "2026-04-23T10:16:00Z"

    work_runs = get_work_item_runs(project_root, "work-1")
    assert [run["run_id"] for run in work_runs] == ["run-a", "run-b"]

    active = get_active_run_for_work_item(project_root, "work-1")
    assert active is not None
    assert active["run_id"] == "run-a"
    assert active["latest_message"] == "step 520"

    run_a_state = runs_dir / "run-a" / "state.json"
    _write_json(run_a_state, {"status": "completed", "phase": "completed", "progress_pct": 100, "updated_at": "2026-04-23T10:17:00Z"})
    assert get_active_run_for_work_item(project_root, "work-1") is None
    latest = get_latest_run_for_work_item(project_root, "work-1")
    assert latest is not None
    assert latest["run_id"] == "run-a"


def test_get_run_events_supports_cursor_paging(tmp_path, monkeypatch):
    project_root = tmp_path
    runs_dir = project_root / ".thoth" / "runs"
    monkeypatch.setenv("THOTH_RUNS_DIR", str(runs_dir))

    _write_json(runs_dir / "run-c" / "run.json", {"run_id": "run-c", "work_id": "work-2"})
    _write_jsonl(runs_dir / "run-c" / "events.jsonl", [
        {"seq": 1, "ts": "2026-04-23T00:00:00Z", "kind": "log", "message": "one"},
        {"seq": 2, "ts": "2026-04-23T00:01:00Z", "kind": "log", "message": "two"},
        {"seq": 3, "ts": "2026-04-23T00:02:00Z", "kind": "log", "message": "three"},
    ])

    page = get_run_events(project_root, "run-c", after_seq=1, limit=2)
    assert page is not None
    assert [event["seq"] for event in page["events"]] == [2, 3]
    assert page["next_after_seq"] == 3
    assert page["has_more"] is False


def test_get_run_worker_logs_returns_phase_stdout_and_stderr_tails(tmp_path, monkeypatch):
    project_root = tmp_path
    runs_dir = project_root / ".thoth" / "runs"
    monkeypatch.setenv("THOTH_RUNS_DIR", str(runs_dir))

    _write_json(runs_dir / "run-log" / "run.json", {"run_id": "run-log", "work_id": "work-logs"})
    _write_json(runs_dir / "run-log" / "state.json", {"status": "running", "phase": "plan"})
    (runs_dir / "run-log" / "worker-logs").mkdir(parents=True)
    (runs_dir / "run-log" / "worker-logs" / "plan.stdout.log").write_text("x" * 1100 + "stdout-tail", encoding="utf-8")
    (runs_dir / "run-log" / "worker-logs" / "plan.stderr.log").write_text("stderr-tail", encoding="utf-8")

    payload = get_run_worker_logs(project_root, "run-log", phase="plan", tail=1000)

    assert payload is not None
    assert payload["run_id"] == "run-log"
    assert payload["tail"] == 1000
    assert payload["status"] == "running"
    assert payload["current_phase"] == "plan"
    assert set(payload["logs"]) == {"plan"}
    assert payload["logs"]["plan"]["stdout"]["exists"] is True
    assert payload["logs"]["plan"]["stdout"]["tail"].endswith("stdout-tail")
    assert len(payload["logs"]["plan"]["stdout"]["tail"]) == 1000
    assert payload["logs"]["plan"]["stderr"]["tail"] == "stderr-tail"
