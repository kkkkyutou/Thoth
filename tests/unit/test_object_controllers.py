"""Tests for object-graph controller services."""

from __future__ import annotations

from thoth.objects import Store
from thoth.plan.store import ensure_work_authority_tree, upsert_work_item, upsert_decision
from thoth.run.controllers import create_auto_controller, create_orchestration_controller, list_auto_actionable_work
from thoth.run.phases import default_validate_output_schema


def _work_payload(work_id: str) -> dict:
    return {
        "work_id": work_id,
        "title": work_id,
        "status": "ready",
        "work_kind": "execution",
        "runnable": True,
        "goal": f"Complete {work_id}",
        "context": "test",
        "constraints": ["small"],
        "execution_plan": ["execute one step"],
        "eval_contract": {
            "entrypoint": {"command": "true"},
            "primary_metric": {"name": "ok", "direction": "gte", "threshold": 1},
            "failure_classes": ["failed"],
            "validate_output_schema": default_validate_output_schema(),
        },
        "runtime_policy": {"loop": {"max_iterations": 3, "max_runtime_seconds": 60}},
        "decisions": ["DEC-001"],
        "missing_questions": [],
    }


def _seed_ready_work(tmp_path, *work_ids: str) -> None:
    ensure_work_authority_tree(tmp_path)
    upsert_decision(
        tmp_path,
        {
            "decision_id": "DEC-001",
            "question": "method",
            "status": "frozen",
            "candidate_method_ids": ["direct"],
            "unresolved_gaps": [],
        },
    )
    for work_id in work_ids:
        upsert_work_item(tmp_path, _work_payload(work_id))


def test_orchestration_controller_batches_by_depends_on_links(tmp_path):
    _seed_ready_work(tmp_path, "work-a", "work-b")
    store = Store(tmp_path)
    store.link("work_item", "work-b", link_type="depends_on", target_kind="work_item", target_id="work-a")

    controller = create_orchestration_controller(tmp_path, work_ids=["work-a", "work-b"], host="codex", executor="claude")

    assert controller["kind"] == "controller"
    assert controller["payload"]["controller_type"] == "orchestration"
    assert controller["payload"]["batches"] == [["work-a"], ["work-b"]]
    assert controller["payload"]["work_refs"][0]["revision"] == 1


def test_auto_controller_records_linear_queue_cursor(tmp_path):
    _seed_ready_work(tmp_path, "work-a", "work-b")

    controller = create_auto_controller(tmp_path, work_ids=["work-a", "work-b"], mode="loop", host="codex", executor="claude")

    assert controller["payload"]["controller_type"] == "auto"
    assert controller["payload"]["mode"] == "loop"
    assert [item["work_id"] for item in controller["payload"]["queue"]] == ["work-a", "work-b"]
    assert controller["payload"]["cursor"] == {
        "index": 0,
        "active_run_id": None,
        "completed_work_ids": [],
        "rounds_attempted": 0,
    }
    assert controller["payload"]["min_runtime_seconds"] == 8 * 60 * 60
    assert controller["payload"]["request_fingerprint"] == {
        "mode": "loop",
        "host": "codex",
        "executor": "claude",
        "scope": "all-open",
        "rounds": None,
        "min_runtime_seconds": 8 * 60 * 60,
        "sleep_requested": False,
        "fixed_queue": True,
        "work_refs": [
            {"work_id": "work-a", "revision": 1},
            {"work_id": "work-b", "revision": 1},
        ],
    }


def test_auto_controller_records_temporary_guidance_without_fingerprint_drift(tmp_path):
    _seed_ready_work(tmp_path, "work-a")

    controller = create_auto_controller(
        tmp_path,
        work_ids=["work-a"],
        mode="loop",
        host="codex",
        executor="codex",
        invocation_guidance="repair repo-local imports before failing",
    )

    assert controller["payload"]["guidance"]["message"] == "repair repo-local imports before failing"
    assert controller["payload"]["guidance"]["semantics"].startswith("temporary controller-level")
    assert "guidance" not in controller["payload"]["request_fingerprint"]


def test_auto_actionable_work_orders_by_scheduling_priority(tmp_path):
    _seed_ready_work(tmp_path, "work-low", "work-high")
    low = Store(tmp_path).read("work_item", "work-low")
    high = Store(tmp_path).read("work_item", "work-high")
    Store(tmp_path).update(
        "work_item",
        "work-low",
        expected_revision=low["revision"],
        updates={"payload": {**low["payload"], "scheduling": {"priority": 1}}},
        history_summary="set low priority",
    )
    Store(tmp_path).update(
        "work_item",
        "work-high",
        expected_revision=high["revision"],
        updates={"payload": {**high["payload"], "scheduling": {"priority": 10}}},
        history_summary="set high priority",
    )

    rows = list_auto_actionable_work(tmp_path)

    assert [item["work_id"] for item in rows[:2]] == ["work-high", "work-low"]
