"""Tests for the mechanical run/loop phase controller."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.run.packets import prepare_execution
from thoth.run.phases import (
    default_validate_output_schema,
    next_phase_payload,
    submit_phase_output,
)


def _prepare_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / ".thoth" / "project").mkdir(parents=True)
    return project


def _strict_task(*, runtime_contract: dict | None = None) -> dict:
    payload = {
        "work_id": "task-1",
        "title": "Demo task",
        "work_goal": "Ship the demo work.",
        "implementation_recipe": ["Plan edits", "Execute edits", "Run validator"],
        "eval_entrypoint": {"command": "pytest -q"},
        "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
        "failure_classes": ["runtime_drift"],
        "validate_output_schema": default_validate_output_schema(),
    }
    if runtime_contract is not None:
        payload["runtime_contract"] = runtime_contract
    return payload


def _plan_payload(summary: str = "plan ok") -> dict:
    return {
        "summary": summary,
        "authority_complete": True,
        "open_gaps": [],
        "plan": (
            "# Plan\n\n"
            f"{summary}\n\n"
            "Implement the final architecture directly and run the official validator."
        ),
    }


def _execute_payload(summary: str = "exec ok") -> dict:
    return {
        "summary": summary,
        "report": f"# Execute Report\n\n{summary}\n\nFollowed the final-architecture plan.",
        "official_validation_receipt": {
            "command": "pytest -q",
            "exit_code": 0,
            "passed": True,
            "checks_summary": ["passed"],
            "stdout_log": "passed\n",
            "stderr_log": "",
        },
    }


def _reflect_failed_no_retry(*, summary: str = "reflect ok", next_hint: str = "change implementation before retrying") -> dict:
    return {
        "summary": summary,
        "outcome": "failed",
        "review": "# Review\n\nThe validator failed; do not weaken acceptance.",
        "failure_class": "checks",
        "root_cause": "validator failed",
        "corrective_prompt": next_hint,
        "retry_authorized": False,
    }


def test_run_state_machine_completes_after_validate_pass(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Demo task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(),
        goal="ship demo",
    )

    phase = next_phase_payload(project, handle.run_id)
    assert phase["phase"] == "plan"
    submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload=_plan_payload(),
    )
    submit_phase_output(
        project,
        handle.run_id,
        phase="execute",
        payload=_execute_payload(),
    )
    interim = submit_phase_output(
        project,
        handle.run_id,
        phase="validate",
        payload={
            "summary": "pass",
            "passed": True,
            "metric_name": "checks",
            "metric_value": 1,
            "threshold": 1,
            "checks": [{"name": "checks", "ok": True}],
        },
    )
    assert interim["terminal"] is False
    assert interim["next_phase"] == "reflect"
    result = submit_phase_output(
        project,
        handle.run_id,
        phase="reflect",
        payload={
            "summary": "reflect ok",
            "outcome": "passed",
            "review": "# Review\n\nThe validator passed; close the run.",
        },
    )

    assert result["terminal"] is True
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["status"] == "completed"
    assert run_result["result"]["validate_passed"] is True
    assert run_result["result"]["phase_statuses"]["execute"] == "completed"
    assert run_result["result"]["phase_statuses"]["validate"] == "completed"
    assert run_result["result"]["phase_statuses"]["reflect"] == "completed"


def test_run_state_machine_forces_reflect_after_validate_failure(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Broken task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(),
        goal="ship demo",
    )
    submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload=_plan_payload(),
    )
    submit_phase_output(
        project,
        handle.run_id,
        phase="execute",
        payload=_execute_payload(),
    )
    interim = submit_phase_output(
        project,
        handle.run_id,
        phase="validate",
        payload={
            "summary": "fail",
            "passed": False,
            "metric_name": "checks",
            "metric_value": 0,
            "threshold": 1,
            "checks": [{"name": "checks", "ok": False}],
        },
    )
    assert interim["terminal"] is False
    assert interim["next_phase"] == "reflect"

    final = submit_phase_output(
        project,
        handle.run_id,
        phase="reflect",
        payload=_reflect_failed_no_retry(next_hint="change implementation before retrying"),
    )
    assert final["terminal"] is True
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["status"] == "failed"
    assert run_result["result"]["phase_statuses"]["validate"] == "failed"
    assert run_result["result"]["phase_statuses"]["reflect"] == "completed"
    assert run_result["result"]["next_hint"] == "change implementation before retrying"


def test_plan_authority_gap_terminalizes_before_execute(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Ambiguous task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(),
        goal="ship demo",
    )

    result = submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload={
            **_plan_payload("needs input"),
            "authority_complete": False,
            "open_gaps": [{"field": "authority_context", "reason": "empty"}],
        },
    )

    assert result["terminal"] is True
    assert result["status"] == "failed"
    assert result["reason"] == "needs_input"
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["status"] == "failed"
    assert run_result["checks"][0]["detail"] == "needs_input"
    plan_artifact = json.loads((handle.run_dir / "plan.json").read_text(encoding="utf-8"))
    assert plan_artifact["open_gaps"] == ['{"field":"authority_context","reason":"empty"}']
    assert plan_artifact["_normalization_warnings"][0]["field"] == "plan.open_gaps"
    phase_state = json.loads((handle.run_dir / "phase_state.json").read_text(encoding="utf-8"))
    assert "execute" not in phase_state["phase_statuses"]


def test_execute_legacy_plan_artifact_read_is_optional(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Demo task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(),
        goal="ship demo",
    )
    submit_phase_output(project, handle.run_id, phase="plan", payload=_plan_payload())

    result = submit_phase_output(
        project,
        handle.run_id,
        phase="execute",
        payload={**_execute_payload(), "plan_artifact_read": False},
    )

    assert result["next_phase"] == "validate"
    execute_artifact = json.loads((handle.run_dir / "execute.json").read_text(encoding="utf-8"))
    assert execute_artifact["plan_artifact_read"] is False


def test_loop_parent_stops_on_iteration_budget(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="loop",
        title="Loop task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(
            runtime_contract={"loop": {"max_iterations": 2, "max_runtime_seconds": 28800}}
        ),
        goal="close loop",
    )

    for _ in range(2):
        phase = next_phase_payload(project, handle.run_id)
        assert phase["phase"] == "plan"
        submit_phase_output(
            project,
            handle.run_id,
            phase="plan",
            payload=_plan_payload(),
        )
        submit_phase_output(
            project,
            handle.run_id,
            phase="execute",
            payload=_execute_payload(),
        )
        submit_phase_output(
            project,
            handle.run_id,
            phase="validate",
            payload={
                "summary": "fail",
                "passed": False,
                "metric_name": "checks",
                "metric_value": 0,
                "threshold": 1,
                "checks": [{"name": "checks", "ok": False}],
            },
        )
        result = submit_phase_output(
            project,
            handle.run_id,
            phase="reflect",
            payload=_reflect_failed_no_retry(next_hint="retry with a better plan"),
        )

    assert result["terminal"] is True
    assert result["status"] == "failed"
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["result"]["iterations_attempted"] == 2
    assert run_result["result"]["budget_exhausted_by"] == "max_iterations"
    assert len(run_result["result"]["child_run_ids"]) == 2


def test_loop_retry_context_is_passed_to_next_child(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="loop",
        title="Loop task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(runtime_contract={"loop": {"max_iterations": 3, "max_runtime_seconds": 28800}}),
        goal="close loop",
    )

    assert next_phase_payload(project, handle.run_id)["phase"] == "plan"
    submit_phase_output(project, handle.run_id, phase="plan", payload=_plan_payload())
    submit_phase_output(project, handle.run_id, phase="execute", payload=_execute_payload())
    submit_phase_output(
        project,
        handle.run_id,
        phase="validate",
        payload={
            "summary": "fail",
            "passed": False,
            "metric_name": "checks",
            "metric_value": 0,
            "threshold": 1,
            "checks": [{"name": "checks", "ok": False}],
        },
    )
    first_result = submit_phase_output(
        project,
        handle.run_id,
        phase="reflect",
        payload=_reflect_failed_no_retry(next_hint="change implementation before retrying"),
    )

    assert first_result["terminal"] is False
    next_packet = next_phase_payload(project, handle.run_id)
    assert next_packet["phase"] == "plan"
    loop_context = next_packet["loop_context"]
    assert loop_context["previous_reflect"]["root_cause"] == "validator failed"
    assert loop_context["last_retry_decision"]["action"] == "retry"
    assert loop_context["last_retry_decision"]["next_plan_hint"] == "change implementation before retrying"


def test_loop_stops_on_child_needs_input_without_retry(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="loop",
        title="Loop task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(runtime_contract={"loop": {"max_iterations": 3, "max_runtime_seconds": 28800}}),
        goal="close loop",
    )

    assert next_phase_payload(project, handle.run_id)["phase"] == "plan"
    result = submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload={**_plan_payload("needs input"), "authority_complete": False, "open_gaps": ["acceptance not closed"]},
    )

    assert result["terminal"] is True
    assert result["status"] == "failed"
    assert result["reason"] == "needs_input"
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["result"]["final_outcome"] == "stopped_by_retry_policy"
    assert run_result["result"]["retry_decision"]["action"] == "stop"
    assert run_result["result"]["retry_decision"]["reason"] == "needs_input"
