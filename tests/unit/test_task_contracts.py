"""Tests for canonical discussion/decision/work_item object authority."""

from __future__ import annotations

from thoth.objects import ActiveExecutionLock, Store, flatten_work_item, work_item_ready_errors
from thoth.init.service import initialize_project
from thoth.plan.compiler import compile_task_authority
from thoth.plan.discuss import checkpoint_discussion_authority, close_discussion_authority
from thoth.plan.doctor import build_doctor_payload
from thoth.plan.store import (
    create_discussion_placeholder,
    ensure_work_authority_tree,
    load_work_for_execution,
    load_work_result,
    upsert_work_item,
    upsert_decision,
    upsert_work_result,
)
from thoth.run.ledger import create_run, fail_run
from thoth.run.phases import default_validate_output_schema
from thoth.run.service import stop_run


def _ready_work_payload(decision_id: str = "DEC-001") -> dict:
    return {
        "work_id": "work-1",
        "title": "Runtime validation",
        "status": "ready",
        "work_kind": "execution",
        "runnable": True,
        "goal": "Validate runtime lifecycle.",
        "context": "runtime",
        "constraints": ["tmp-project"],
        "execution_plan": ["Run detached lifecycle."],
        "eval_contract": {
            "entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
            "failure_classes": ["runtime_drift"],
            "validate_output_schema": default_validate_output_schema(),
        },
        "runtime_policy": {"loop": {"max_iterations": 3, "max_runtime_seconds": 60}},
        "decisions": [decision_id],
        "missing_questions": [],
    }


def _closed_authority_capsule() -> dict:
    return {
        "semantic_events": [
            {
                "event_type": "goal",
                "source_summary": "用户要验证 runtime lifecycle。",
                "normalized_summary": "Validate runtime lifecycle.",
                "evidence_anchor": {"turn": "user-1", "quote": "验证 runtime lifecycle"},
                "affects": ["goal"],
            }
        ],
        "goal": {
            "source_summary": "验证 runtime lifecycle。",
            "normalized_summary": "Validate runtime lifecycle.",
        },
        "non_goals": [],
        "constraints": ["temp-project"],
        "accepted_decisions": [
            {
                "decision_id": "DEC-runtime-lifecycle",
                "question": "Which validator should be used?",
                "selected_values": {"validator": "pytest -q"},
                "status": "frozen",
                "unresolved_gaps": [],
            }
        ],
        "rejected_options": ["do not invent a validator"],
        "acceptance": {"normalized_summary": "pytest must pass"},
        "context_evidence": [{"path": "tests/unit/test_task_contracts.py"}],
        "risks": [],
        "run_instructions": ["Run pytest."],
        "open_questions": [],
        "language": {"source": "zh", "runtime": "en"},
        "completeness": {"is_closed": True},
        "work_item": _ready_work_payload("DEC-runtime-lifecycle"),
    }


def test_discuss_work_json_creates_ready_work_item_object(tmp_path):
    ensure_work_authority_tree(tmp_path)
    decision = upsert_decision(
        tmp_path,
        {
            "decision_id": "DEC-001",
            "question": "Which method should be used?",
            "candidate_method_ids": ["real-process"],
            "selected_values": {"candidate_method_id": "real-process"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    work = upsert_work_item(tmp_path, _ready_work_payload(decision["decision_id"]))
    compiler = compile_task_authority(tmp_path)

    assert compiler["summary"]["work_item_counts"]["ready"] == 1
    assert compiler["summary"]["decision_counts"]["accepted"] == 1

    loaded = load_work_for_execution(tmp_path, "work-1")
    assert loaded["ready_state"] == "ready"
    assert loaded["work_id"] == "work-1"
    assert loaded["revision"] == 1
    assert loaded["runtime_contract"]["loop"]["max_iterations"] == 3


def test_ready_gate_rejects_missing_eval_contract(tmp_path):
    ensure_work_authority_tree(tmp_path)
    payload = _ready_work_payload()
    payload["eval_contract"].pop("validate_output_schema")
    work = upsert_work_item(tmp_path, payload)
    assert work["ready_state"] == "blocked"
    assert "validate_output_schema" in work["blocking_reason"]
    compiler = compile_task_authority(tmp_path)
    assert compiler["summary"]["work_item_counts"]["blocked"] == 1


def test_inquiring_discussion_does_not_generate_ready_work(tmp_path):
    ensure_work_authority_tree(tmp_path)
    discussion = create_discussion_placeholder(tmp_path, "Need to freeze method universe")
    compiler = compile_task_authority(tmp_path)
    assert discussion["status"] == "inquiring"
    assert compiler["summary"]["work_item_counts"]["ready"] == 0
    assert (tmp_path / ".thoth" / "objects" / "discussion" / f"{discussion['discussion_id']}.json").exists()


def test_discussion_authority_checkpoint_does_not_create_ready_work(tmp_path):
    ensure_work_authority_tree(tmp_path)
    discussion = create_discussion_placeholder(tmp_path, "Need to preserve all decisions")

    result = checkpoint_discussion_authority(
        tmp_path,
        discussion_id=discussion["discussion_id"],
        capsule={
            "semantic_events": [
                {
                    "event_type": "constraint",
                    "source_summary": "不要丢失讨论里的约束。",
                    "normalized_summary": "Do not lose discussion constraints.",
                    "evidence_anchor": {"turn": "user-1"},
                    "affects": ["constraints"],
                }
            ],
            "open_questions": ["validator not closed"],
            "completeness": {"is_closed": False},
        },
    )
    compiler = compile_task_authority(tmp_path)

    assert result["checkpoint"]["authority_context"]["semantic_events"][0]["status"] == "draft"
    assert compiler["summary"]["work_item_counts"]["ready"] == 0


def test_discussion_authority_close_creates_ready_work_with_context(tmp_path):
    ensure_work_authority_tree(tmp_path)
    discussion = create_discussion_placeholder(tmp_path, "Close runtime work")

    result = close_discussion_authority(
        tmp_path,
        discussion_id=discussion["discussion_id"],
        capsule=_closed_authority_capsule(),
    )
    compiler = compile_task_authority(tmp_path)
    loaded = load_work_for_execution(tmp_path, "work-1")

    assert result["status"] == "ok"
    assert result["discussion"]["status"] == "closed"
    assert compiler["summary"]["work_item_counts"]["ready"] == 1
    assert loaded["authority_context"]["completeness"]["is_closed"] is True
    assert loaded["authority_context"]["source_discussion_id"] == discussion["discussion_id"]
    assert loaded["authority_context"]["semantic_events"][0]["event_type"] == "goal"


def test_discussion_authority_close_with_open_questions_needs_input(tmp_path):
    ensure_work_authority_tree(tmp_path)
    discussion = create_discussion_placeholder(tmp_path, "Still ambiguous")
    capsule = _closed_authority_capsule()
    capsule["open_questions"] = ["acceptance not closed"]
    capsule["completeness"] = {"is_closed": False}

    result = close_discussion_authority(tmp_path, discussion_id=discussion["discussion_id"], capsule=capsule)
    compiler = compile_task_authority(tmp_path)

    assert result["status"] == "needs_input"
    assert result["discussion"]["status"] == "inquiring"
    assert compiler["summary"]["work_item_counts"]["ready"] == 0


def test_discussion_authority_close_requires_stable_work_id(tmp_path):
    ensure_work_authority_tree(tmp_path)
    discussion = create_discussion_placeholder(tmp_path, "Close runtime work")
    capsule = _closed_authority_capsule()
    capsule["work_item"] = dict(capsule["work_item"])
    capsule["work_item"].pop("work_id", None)

    result = close_discussion_authority(tmp_path, discussion_id=discussion["discussion_id"], capsule=capsule)
    compiler = compile_task_authority(tmp_path)

    assert result["status"] == "needs_input"
    assert "closed authority work_item requires stable work_id" in result["diagnostics"]["work_item_ready_errors"]
    assert compiler["summary"]["work_item_counts"]["ready"] == 0


def test_doctor_reads_object_graph_and_flags_legacy_yaml(tmp_path):
    ensure_work_authority_tree(tmp_path)
    legacy_task = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1" / "task-1.yaml"
    legacy_task.parent.mkdir(parents=True, exist_ok=True)
    legacy_task.write_text("id: task-1\nhypothesis: stale legacy\n", encoding="utf-8")
    payload = build_doctor_payload(tmp_path)
    assert payload["overall_ok"] is False
    assert payload["summary"]["legacy_authority_count"] == 1


def test_doctor_rejects_half_migrated_legacy_project_without_creating_authority(tmp_path):
    legacy_contract = tmp_path / ".thoth" / "project" / "contracts" / "contract-1.json"
    legacy_contract.parent.mkdir(parents=True, exist_ok=True)
    legacy_contract.write_text('{"contract_id":"contract-1"}\n', encoding="utf-8")

    payload = build_doctor_payload(tmp_path)

    assert payload["overall_ok"] is False
    checks = {check["id"]: check for check in payload["checks"]}
    assert checks["authority-tree"]["ok"] is False
    assert checks["project-object-present"]["ok"] is False
    assert checks["no-legacy-authority"]["ok"] is False
    assert "legacy_thoth_project_authority_removed" in checks["no-legacy-authority"]["detail"]
    assert not (tmp_path / ".thoth" / "objects").exists()


def test_doctor_rejects_object_tree_without_project_object(tmp_path):
    ensure_work_authority_tree(tmp_path)

    payload = build_doctor_payload(tmp_path)

    assert payload["overall_ok"] is False
    checks = {check["id"]: check for check in payload["checks"]}
    assert checks["authority-tree"]["ok"] is True
    assert checks["project-object-present"]["ok"] is False


def test_doctor_dashboard_ready_warning_does_not_fail_overall(tmp_path):
    initialize_project({}, tmp_path)
    store = Store(tmp_path)
    project = store.read("project", "project")
    payload = dict(project["payload"])
    project_payload = dict(payload.get("project") or {})
    project_payload["directions"] = []
    payload["project"] = project_payload
    store.update(
        "project",
        "project",
        expected_revision=project["revision"],
        updates={"payload": payload},
        history_summary="clear directions for dashboard warning test",
    )

    payload = build_doctor_payload(tmp_path)

    assert payload["overall_ok"] is True
    assert any(warning["id"] == "dashboard-project-directions" for warning in payload["warnings"])


def test_work_result_read_view_uses_docs_not_work_item_authority(tmp_path):
    ensure_work_authority_tree(tmp_path)
    upsert_work_result(
        tmp_path,
        "work-1",
        {
            "source": "run_result",
            "usable": True,
            "meets_goal": True,
            "conclusion": "Ship",
            "evidence_paths": ["reports/demo.md"],
            "metrics": {},
            "updated_at": "2026-04-24T00:00:00Z",
        },
    )
    work_result = load_work_result(tmp_path, "work-1")
    assert work_result["conclusion"] == "Ship"
    assert ".thoth/docs/work-results/work-1.result.json" in str(
        tmp_path / ".thoth" / "docs" / "work-results" / "work-1.result.json"
    )


def test_active_run_locks_work_item_mutation(tmp_path):
    ensure_work_authority_tree(tmp_path)
    upsert_decision(tmp_path, {"decision_id": "DEC-001", "question": "Method", "status": "frozen", "candidate_method_ids": ["a"], "unresolved_gaps": []})
    upsert_work_item(tmp_path, _ready_work_payload())
    create_run(tmp_path, kind="run", title="Run", work_id="work-1", work_revision=1, host="codex", executor="claude")

    try:
        upsert_work_item(tmp_path, {**_ready_work_payload(), "title": "Changed title"})
    except ActiveExecutionLock as exc:
        assert "work_item:work-1" in str(exc)
    else:
        raise AssertionError("active work item mutation should be rejected")


def test_failed_run_records_attempt_without_closing_ready_work(tmp_path):
    ensure_work_authority_tree(tmp_path)
    upsert_decision(tmp_path, {"decision_id": "DEC-001", "question": "Method", "status": "frozen", "candidate_method_ids": ["a"], "unresolved_gaps": []})
    upsert_work_item(tmp_path, _ready_work_payload())
    handle = create_run(tmp_path, kind="run", title="Run", work_id="work-1", work_revision=1, host="codex", executor="codex")

    fail_run(tmp_path, handle.run_id, summary="Plan failed.", reason="phase worker did not write plan output")

    work_result = load_work_result(tmp_path, "work-1")
    assert work_result["status"] == "attempt_failed"
    assert work_result["usable"] is False
    assert work_result["meets_goal"] is False
    assert work_result["latest_attempt"]["run_id"] == handle.run_id
    assert work_result["latest_attempt"]["status"] == "failed"
    assert work_result["attempt_count"] == 1
    assert work_result["failed_attempt_count"] == 1
    assert Store(tmp_path).read("work_item", "work-1")["status"] == "ready"
    assert load_work_for_execution(tmp_path, "work-1")["ready_state"] == "ready"


def test_stopped_run_records_attempt_without_closing_ready_work(tmp_path):
    ensure_work_authority_tree(tmp_path)
    upsert_decision(tmp_path, {"decision_id": "DEC-001", "question": "Method", "status": "frozen", "candidate_method_ids": ["a"], "unresolved_gaps": []})
    upsert_work_item(tmp_path, _ready_work_payload())
    handle = create_run(tmp_path, kind="run", title="Run", work_id="work-1", work_revision=1, host="codex", executor="codex")

    stop_run(tmp_path, handle.run_id)

    work_result = load_work_result(tmp_path, "work-1")
    assert work_result["status"] == "attempt_stopped"
    assert work_result["latest_attempt"]["run_id"] == handle.run_id
    assert work_result["latest_attempt"]["status"] == "stopped"
    assert work_result["attempt_count"] == 1
    assert work_result["stopped_attempt_count"] == 1
    assert Store(tmp_path).read("work_item", "work-1")["status"] == "ready"
    assert load_work_for_execution(tmp_path, "work-1")["ready_state"] == "ready"
