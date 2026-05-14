"""Tests for strict status script output."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from thoth.observe.status import time_ago
from thoth.objects import Store
from thoth.init.service import initialize_project
from thoth.plan.store import upsert_work_result

from status import (
    is_task_blocked,
    is_task_completed,
    progress_bar,
    quick_health,
    render_status,
    task_current_phase,
)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _setup_project(tmp_path: Path) -> None:
    initialize_project(
        {
            "name": "TestProject",
            "description": "status test",
            "language": "en",
            "directions": ["frontend"],
            "phases": [],
            "port": 8501,
            "theme": "warm-bear",
        },
        tmp_path,
    )


def _write_work_item(tmp_path: Path, work_id: str = "task-1", *, status: str = "validated") -> None:
    Store(tmp_path).upsert(
        kind="work_item",
        object_id=work_id,
        status=status,
        title="Imported",
        summary="Imported work",
        payload={
            "work_kind": "execution",
            "runnable": True,
            "goal": "Imported work",
            "context": "f1",
            "direction": "frontend",
            "module": "f1",
            "constraints": ["test"],
            "execution_plan": ["Inspect status output."],
            "eval_contract": {
                "entrypoint": {"command": "true"},
                "primary_metric": {"name": "ok", "direction": "gte", "threshold": 1},
                "validate_output_schema": {"type": "object"},
            },
            "runtime_policy": {"loop": {"max_iterations": 1, "max_runtime_seconds": 60}},
            "decisions": [],
            "missing_questions": [],
        },
    )


def test_status_output_format(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _setup_project(tmp_path)
    _write_work_item(tmp_path)
    upsert_work_result(
        tmp_path,
        "task-1",
        {"source": "legacy_import", "updated_at": "2026-04-24T00:00:00Z", "evidence_paths": ["reports/demo.md"], "metrics": {}},
    )

    output = render_status(full=False)
    assert "Running:" in output
    assert "Recent:" in output
    assert "Next:" in output
    assert "Health:" in output


def test_status_empty_project(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _setup_project(tmp_path)
    output = render_status(full=False)
    assert "No ready work items found" in output


def test_task_current_phase_with_verdict():
    phase, status = task_current_phase({"work_result": {"updated_at": "2026-04-24T00:00:00Z", "source": "legacy_import"}})
    assert phase == "work_result"
    assert status == "work_result:legacy_import"


def test_is_task_completed():
    assert is_task_completed({"work_result": {"updated_at": "2026-04-24T00:00:00Z"}})
    assert not is_task_completed({"ready_state": "blocked"})


def test_is_task_blocked():
    blocked, blockers = is_task_blocked({"ready_state": "blocked", "depends_on": [{"work_id": "dep", "type": "hard"}]}, [])
    assert blocked
    assert blockers == ["dep"]


def test_progress_bar():
    bar = progress_bar(50, width=10)
    assert len(bar) == 12
    assert bar.startswith("[")
    assert bar.endswith("]")


def test_quick_health_all_present(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _setup_project(tmp_path)
    healthy, msg = quick_health()
    assert healthy
    assert "Strict authority" in msg or "Last run-log update" in msg


def test_time_ago_accepts_naive_timestamp_as_utc():
    value = time_ago("2026-04-25 14:47")
    assert value.endswith("ago")
