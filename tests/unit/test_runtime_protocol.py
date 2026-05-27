"""Tests for Thoth internal runtime protocol helpers."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from thoth.prompt_validators import utf8_len, validate_phase_output
from thoth.prompt_specs import phase_prompt_authority
from thoth.objects import Store
from thoth.run.driver import execute_runtime_controller
from thoth.run.argue import run_argue
from thoth.run.ledger import (
    _update_state,
    append_protocol_event,
    complete_run,
    create_run,
    fail_run,
    heartbeat_run,
    record_artifact,
)
from thoth.run.model import CLAUDE_EXTERNAL_WORKER_ALLOWED_TOOLS
from thoth.run.packets import prepare_execution
from thoth.run.phases import default_validate_output_schema, next_phase_payload, submit_phase_output
from thoth.run.guidance import append_run_guidance, pending_interrupt_guidance
from thoth.run.worker import ExternalWorkerPhaseDriver, build_external_worker_prompt, external_worker_command


def _prepare_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / ".thoth" / "project").mkdir(parents=True)
    return project


def _plan_payload(summary: str = "plan ok") -> dict:
    return {
        "summary": summary,
        "authority_complete": True,
        "open_gaps": [],
        "history_action": "continue",
        "plan": (
            "# Plan\n\n"
            f"{summary}\n\n"
            "Implement the final architecture directly, reject MVP/fallback/mock shortcuts, and run pytest."
        ),
    }


def _execute_payload(summary: str = "exec ok") -> dict:
    return {
        "summary": summary,
        "report": f"# Execute Report\n\n{summary}\n\nFollowed the final-architecture plan and ran validation.",
        "official_validation_receipt": {
            "command": "pytest -q",
            "exit_code": 0,
            "passed": True,
            "checks_summary": ["passed"],
            "stdout_log": "passed\n",
            "stderr_log": "",
        },
    }


def _receipt_payload(handle, *, passed: bool = True, command: str = "pytest -q") -> dict:
    log_dir = handle.run_dir / "worker-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_log = log_dir / f"validator-{len(list(log_dir.glob('validator-*.stdout.log')))+1}.stdout.log"
    stderr_log = log_dir / f"validator-{len(list(log_dir.glob('validator-*.stderr.log')))+1}.stderr.log"
    stdout_log.write_text("passed\n" if passed else "failed\n", encoding="utf-8")
    stderr_log.write_text("", encoding="utf-8")
    return {
        "command": command,
        "cwd": str(handle.project_root),
        "python_executable": "/opt/conda/envs/thoth-demo/bin/python",
        "env_summary": {"CONDA_PREFIX": "/opt/conda/envs/thoth-demo", "CUDA_VISIBLE_DEVICES": "0"},
        "exit_code": 0 if passed else 1,
        "passed": passed,
        "checks_summary": ["official validator passed" if passed else "official validator failed"],
        "stdout_log": str(stdout_log),
        "stderr_log": str(stderr_log),
    }


def _inline_receipt_payload(*, passed: bool = True, command: str = "pytest -q", metric_value: float | int = 1) -> dict:
    return {
        "command": command,
        "cwd": "/tmp/project",
        "python_executable": "/opt/conda/bin/python",
        "env_summary": {"CUDA_VISIBLE_DEVICES": "0"},
        "exit_code": 0 if passed else 1,
        "passed": passed,
        "metric_value": metric_value,
        "checks_summary": ["official validator passed" if passed else "official validator failed"],
        "stdout_log": "============================= test session starts =============================\n3 passed\n",
        "stderr_log": "[empty stderr captured]",
    }


def test_plan_gap_schema_drift_normalizes_jsonish_items():
    payload = {
        **_plan_payload("authority incomplete"),
        "authority_complete": False,
        "open_gaps": [{"field": "authority_context", "reason": "empty"}],
    }

    normalized = validate_phase_output("plan", payload)

    assert normalized["open_gaps"] == ['{"field":"authority_context","reason":"empty"}']
    assert normalized["_normalization_warnings"][0]["field"] == "plan.open_gaps"
    assert normalized["_normalization_warnings"][0]["reason"] == "coerced_to_json_string"


def test_plan_drops_extra_mechanical_fields():
    payload = {
        **_plan_payload("discover source paths"),
        "discovery_tasks": ["locate TRELLIS2 source tree", "create missing target test file"],
    }

    normalized = validate_phase_output("plan", payload)

    assert "discovery_tasks" not in normalized
    assert any(
        item["field"] == "plan.discovery_tasks" and item["reason"] == "unknown_field_dropped"
        for item in normalized["_normalization_warnings"]
    )


def test_phase_summary_budgets_are_relaxed():
    assert phase_prompt_authority("plan")["summary_budget_utf8"] == 1200
    assert phase_prompt_authority("reflect")["summary_budget_utf8"] == 1200
    assert phase_prompt_authority("execute")["summary_budget_utf8"] == 800
    assert phase_prompt_authority("validate")["summary_budget_utf8"] == 800


def test_plan_long_fields_normalize_without_schema_failure():
    long_text = "x" * 1500
    payload = {
        **_plan_payload(long_text),
        "plan": long_text * 10,
        "open_gaps": [long_text],
    }

    normalized = validate_phase_output("plan", payload)

    assert utf8_len(normalized["summary"]) <= 1200
    assert utf8_len(normalized["plan"]) <= 12000
    assert utf8_len(normalized["open_gaps"][0]) <= 1024
    warning_fields = {row["field"] for row in normalized["_normalization_warnings"]}
    assert "plan.plan" in warning_fields
    assert "plan.open_gaps" in warning_fields


def test_prepare_execution_synthesizes_authority_from_legacy_discussion_ref(tmp_path):
    project = _prepare_project(tmp_path)
    store = Store(project)
    closure = {
        "schema_version": 1,
        "source_discussion_id": "DISC-closed",
        "source_decision_ids": [],
        "semantic_events": [],
        "goal": "closed goal",
        "constraints": ["closed constraint"],
        "accepted_decisions": [],
        "rejected_options": [],
        "acceptance": {"normalized_summary": "pytest passes"},
        "run_instructions": ["run pytest"],
        "open_questions": [],
        "completeness": {"is_closed": True, "unresolved_count": 0, "blocking_reasons": []},
    }
    store.create(
        kind="discussion",
        object_id="DISC-closed",
        status="closed",
        title="Closed authority",
        summary="Closed authority",
        source="test",
        payload={"closure": closure},
    )
    strict_task = {
        "work_id": "task-1",
        "title": "Legacy work",
        "goal_statement": "Run legacy work",
        "context": "EVA design: DISC-closed (closed)",
        "constraints": ["local"],
        "implementation_recipe": ["edit", "test"],
        "eval_entrypoint": {"command": "pytest -q"},
        "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
        "decision_ids": ["DISC-closed"],
        "validate_output_schema": default_validate_output_schema(),
    }

    handle, packet = prepare_execution(
        project,
        command_id="run",
        title="Legacy work",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task=strict_task,
        goal="Run legacy work",
    )

    assert packet["strict_task"]["authority_context"]["source_discussion_id"] == "DISC-closed"
    assert packet["strict_task"]["_authority_resolution"]["source"] == "legacy_discussion_ref"
    resolution = json.loads((handle.run_dir / "authority-resolution.json").read_text(encoding="utf-8"))
    assert resolution["source"] == "legacy_discussion_ref"


def test_invocation_guidance_flows_into_phase_packets(tmp_path):
    project = _prepare_project(tmp_path)
    handle, packet = prepare_execution(
        project,
        command_id="run",
        title="Guided run",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Guided run", "eval_entrypoint": {"command": "pytest -q"}},
        goal="guided run",
        invocation_guidance="Focus on repo-local flex_gemm repair before giving up.",
    )

    assert packet["guidance"]["initial"]["message"] == "Focus on repo-local flex_gemm repair before giving up."
    phase = next_phase_payload(project, handle.run_id)
    assert phase["guidance"]["inherited"]["initial"]["source"] == "initial_invocation"
    assert phase["guidance"]["current"]["tail"][0]["message"] == "Focus on repo-local flex_gemm repair before giving up."
    assert "policy" not in phase["guidance"]["current"]


def test_live_guidance_interrupt_can_be_pending_for_phase(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Interrupt run",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Interrupt run", "eval_entrypoint": {"command": "pytest -q"}},
        goal="interrupt run",
    )

    entry = append_run_guidance(
        project,
        handle.run_id,
        message="现在改，不要继续当前实现",
        source="host_agent",
        phase="execute",
        interrupt_requested=True,
    )

    assert pending_interrupt_guidance(project, handle.run_id, phase="plan") is None
    pending = pending_interrupt_guidance(project, handle.run_id, phase="execute")
    assert pending and pending["guidance_id"] == entry["guidance_id"]


def test_execute_validate_and_reflect_long_fields_normalize_without_schema_failure():
    long_text = "y" * 1300

    execute = validate_phase_output(
        "execute",
        {
            **_execute_payload(long_text),
            "official_validation_receipt": {"command": long_text, "passed": True},
        },
    )
    assert utf8_len(execute["summary"]) <= 800
    assert execute["_normalization_warnings"]

    validate = validate_phase_output(
        "validate",
        {
            "summary": long_text,
            "passed": False,
            "metric_name": "checks",
            "metric_value": 0,
            "threshold": 1,
            "checks": [{"name": "check", "ok": False, "detail": long_text}],
        },
    )
    assert utf8_len(validate["summary"]) <= 800
    assert utf8_len(validate["checks"][0]["detail"]) <= 1024
    assert validate["_normalization_warnings"]

    reflect = validate_phase_output(
        "reflect",
        {
            "summary": long_text,
            "review": long_text * 10,
            "outcome": "failed",
            "corrective_prompt": long_text,
            "retry_authorized": True,
        },
    )
    assert utf8_len(reflect["summary"]) <= 1200
    assert utf8_len(reflect["review"]) <= 12000
    assert utf8_len(reflect["corrective_prompt"]) <= 2000
    assert reflect["retry_authorized"] is True
    assert reflect["_normalization_warnings"]


def test_reflect_object_outcome_normalizes_when_status_is_clear():
    payload = validate_phase_output(
        "reflect",
        {
            "summary": "reflect failed validation",
            "outcome": {"status": "failed", "reason": "runtime contract"},
            "review": "# Review\n\nValidation evidence was not sufficient.",
            "corrective_prompt": "Return stronger official validation evidence.",
            "retry_authorized": False,
        },
    )

    assert payload["outcome"] == "failed"
    assert any(item["field"] == "reflect.outcome" and item["reason"] == "object_outcome_normalized" for item in payload["_normalization_warnings"])


def test_reflect_object_outcome_normalizes_passed_status():
    payload = validate_phase_output(
        "reflect",
        {
            "summary": "reflect passed validation",
            "outcome": {"status": "passed"},
            "review": "# Review\n\nEvidence is sufficient.",
        },
    )

    assert payload["outcome"] == "passed"
    assert any(item["field"] == "reflect.outcome" for item in payload["_normalization_warnings"])


def test_mechanical_phase_field_types_remain_strict_but_unknowns_are_dropped():
    try:
        validate_phase_output(
            "validate",
            {
                "summary": "validator ran",
                "passed": "false",
                "metric_name": "checks",
                "metric_value": 0,
                "threshold": 1,
                "checks": [],
            },
        )
    except ValueError as exc:
        assert "validate.passed must be a boolean" in str(exc)
    else:
        raise AssertionError("validate.passed should remain a strict boolean")

    reflect = validate_phase_output(
        "reflect",
        {
            "summary": "reflect",
            "outcome": "failed",
            "review": "# Review\n\nRetry is needed.",
            "failure_class": "x" * 40,
            "corrective_prompt": "fix implementation",
            "retry_authorized": True,
        },
    )
    assert "failure_class" not in reflect
    assert any(
        item["field"] == "reflect.failure_class" and item["reason"] == "unknown_field_dropped"
        for item in reflect["_normalization_warnings"]
    )


def test_prepare_execution_writes_packet_and_live_dispatch(tmp_path):
    project = _prepare_project(tmp_path)
    handle, packet = prepare_execution(
        project,
        command_id="run",
        title="Demo task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Demo task"},
        goal="ship demo",
    )
    assert packet["run_id"] == handle.run_id
    assert packet["dispatch_mode"] == "live_native"
    assert (handle.run_dir / "packet.json").exists()
    assert packet["phase_state"]["current_phase"] == "plan"
    assert len(json.dumps(packet, ensure_ascii=False)) < 3400


def test_protocol_updates_artifacts_and_completion_shape(tmp_path):
    project = _prepare_project(tmp_path)
    handle = create_run(
        project,
        kind="review",
        title="Review demo",
        work_id=None,
        host="claude",
        executor="claude",
        target="src/app.py",
    )
    append_protocol_event(project, handle.run_id, message="started review", kind="log", phase="analyzing", progress_pct=20)
    heartbeat_run(project, handle.run_id, phase="writing_findings", progress_pct=60, note="heartbeat")
    record_artifact(project, handle.run_id, path="artifacts/findings.json", label="findings")
    complete_run(
        project,
        handle.run_id,
        summary="Review finished.",
        result_payload={
            "summary": "1 issue",
            "findings": [
                {
                    "severity": "high",
                    "title": "Missing validation",
                    "path": "src/app.py",
                    "line": 12,
                    "summary": "input guard missing",
                }
            ],
        },
        checks=[{"name": "structured_findings", "ok": True}],
    )

    state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    artifacts = json.loads((handle.run_dir / "artifacts.json").read_text(encoding="utf-8"))
    assert state["status"] == "completed"
    assert result["status"] == "completed"
    assert result["result"]["findings"][0]["title"] == "Missing validation"
    assert artifacts["artifacts"][0]["label"] == "findings"


def test_argue_runtime_records_argument_without_closing_work(tmp_path, monkeypatch):
    project = _prepare_project(tmp_path)
    store = Store(project)
    store.create(
        kind="work_item",
        object_id="task-argue-probe",
        status="ready",
        title="Argue Probe",
        summary="Probe work item",
        source="test",
        payload={
            "goal": "Keep the work direction strong.",
            "context": "test",
            "constraints": ["local"],
            "acceptance_spec": {
                "kind": "script",
                "description": "pytest passes",
                "metric": {"name": "checks", "direction": "gte", "threshold": 1},
            },
            "approach_notes": ["Use real validation."],
            "scheduling": {"order": None},
            "run_limits": {"max_iterations": 1},
            "missing_questions": [],
        },
    )
    monkeypatch.setenv("THOTH_TEST_ARGUE_WORKER_MODE", "complete")

    outcome = run_argue(
        project,
        query="task-argue-probe",
        work_id="task-argue-probe",
        decision_id=None,
        target_kind=None,
        target_id=None,
        host="codex",
        executor="codex",
    )

    assert outcome["exit_code"] == 0
    body = outcome["body"]
    assert body["decision_impact"] == "revise_authority"
    assert Path(body["artifacts"]["argument"]).exists()
    assert Path(body["artifacts"]["authority_patch_preview"]).exists()
    assert Store(project).read("work_item", "task-argue-probe")["status"] == "ready"
    result = json.loads((project / ".thoth" / "runs" / body["run_id"] / "result.json").read_text(encoding="utf-8"))
    assert result["result"]["decision_impact"] == "revise_authority"


def test_review_completion_dedupes_duplicate_findings(tmp_path):
    project = _prepare_project(tmp_path)
    handle = create_run(
        project,
        kind="review",
        title="Review demo",
        work_id=None,
        host="claude",
        executor="claude",
        target="src/app.py",
    )
    complete_run(
        project,
        handle.run_id,
        summary="Review finished.",
        result_payload={
            "summary": "2 issues",
            "findings": [
                {
                    "severity": "high",
                    "title": "Missing validation",
                    "path": "src/app.py",
                    "line": 12,
                    "summary": "input guard missing",
                },
                {
                    "severity": "high",
                    "title": "Missing validation",
                    "path": "src/app.py",
                    "line": 12,
                    "summary": "input guard missing",
                },
            ],
        },
    )
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert len(result["result"]["findings"]) == 1


def test_fail_run_writes_failure_shape(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Broken task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={"work_id": "task-1"},
        goal="broken",
    )
    fail_run(project, handle.run_id, summary="Execution failed.", reason="validator failed")
    state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert state["status"] == "failed"
    assert result["status"] == "failed"
    assert result["checks"][0]["detail"] == "validator failed"


def test_external_worker_prompt_mentions_protocol_and_limits(tmp_path):
    project = _prepare_project(tmp_path)
    handle, packet = prepare_execution(
        project,
        command_id="loop",
        title="Loop demo",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=True,
        strict_task={
            "work_id": "task-1",
            "title": "Loop demo",
            "implementation_recipe": ["Edit files", "Run validator"],
            "eval_entrypoint": {"command": "pytest -q tests/test_demo.py"},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="close loop",
        max_rounds=5,
        max_runtime_seconds=720,
    )
    prompt = build_external_worker_prompt(handle, packet)
    assert handle.run_id in prompt
    assert "Do not invoke `$thoth run`, `$thoth loop`, or `$thoth argue`." in prompt
    assert "\"max_iterations\": 10" in prompt
    assert "pytest -q tests/test_demo.py" in prompt
    assert "Runtime driver capture path" in prompt
    assert "Summary budget UTF-8 bytes" in prompt
    assert len(json.dumps(packet, ensure_ascii=False)) < 4200
    assert len(prompt) < 8500


def test_phase_packets_include_phase_specific_prompt_contract(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Prompt demo",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Prompt demo",
            "implementation_recipe": ["Edit files", "Run validator"],
            "eval_entrypoint": {"command": "pytest -q tests/test_demo.py"},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="close prompt gaps",
    )
    plan_packet = next_phase_payload(project, handle.run_id)
    assert plan_packet["phase"] == "plan"
    assert plan_packet["phase_authority"]["objective"].startswith("Act as a senior planner")
    assert plan_packet["phase_authority"]["summary_budget_utf8"] == 1200

    submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload=_plan_payload(),
    )
    execute_packet = next_phase_payload(project, handle.run_id)
    assert execute_packet["phase"] == "execute"
    assert execute_packet["phase_authority"]["objective"] != plan_packet["phase_authority"]["objective"]
    assert execute_packet["phase_authority"]["summary_budget_utf8"] == 800


def test_phase_output_normalizes_overlong_summary(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Budget demo",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Budget demo"},
        goal="close budget gap",
    )
    too_long = "x" * 1300
    result = submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload={
            "summary": too_long,
            "authority_complete": True,
            "open_gaps": [],
            "history_action": "continue",
            "plan": "# Plan\n\nRun pytest.",
        },
    )

    assert result["next_phase"] == "execute"
    plan_artifact = json.loads((handle.run_dir / "plan.json").read_text(encoding="utf-8"))
    assert utf8_len(plan_artifact["summary"]) <= 1200
    assert plan_artifact["_normalization_warnings"][0]["field"] == "plan.summary"


def test_phase_prompt_includes_execute_role_contract(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Role demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Role demo"},
        goal="exercise role prompt",
    )
    submit_phase_output(project, handle.run_id, phase="plan", payload=_plan_payload())

    prompt = build_external_worker_prompt(handle, {})

    assert "Phase role contract:" in prompt
    assert "Role: act as the implementation and validation engineer" in prompt
    assert "repair repo-local engineering issues" in prompt
    assert "final architecture" in prompt
    assert "MVP, fallback, mock, stub" in prompt
    assert "GPU-first verification posture" in prompt


def test_execute_output_drops_extra_debug_fields():
    payload = validate_phase_output(
        "execute",
        {
            "summary": "execute done",
            "report": "# Execute Report\n\nImplemented the final architecture and ran validation.",
            "official_validation_receipt": {"command": "pytest -q", "passed": True},
            "debug_attempts": [{"name": "flex_gemm import", "status": "fixed"}],
        },
    )

    assert "debug_attempts" not in payload
    assert any(
        item["field"] == "execute.debug_attempts" and item["reason"] == "unknown_field_dropped"
        for item in payload["_normalization_warnings"]
    )


def test_reflect_failure_requires_direct_corrective_prompt():
    payload = validate_phase_output(
        "reflect",
        {
            "summary": "reflect failed validation",
            "outcome": "failed",
            "review": "# Review\n\nValidation failed on a missing dependency; retry execute without weakening acceptance.",
            "corrective_prompt": "Repair the flex_gemm import failure and rerun the official validator.",
            "retry_authorized": True,
        },
        prior_validate_payload={
            "summary": "pytest failed",
            "passed": False,
            "metric_name": "bitwise_identical",
            "metric_value": 0.0,
            "threshold": 1.0,
            "checks": [
                {"name": "test_flex_gemm", "passed": False, "details": "ModuleNotFoundError: No module named 'flex_gemm'"},
            ],
        },
    )

    assert "failure_class" not in payload
    assert "root_cause" not in payload
    assert "flex_gemm" in payload["corrective_prompt"]
    assert payload["retry_authorized"] is True
    assert payload["_normalization_warnings"] == []


def test_reflect_runtime_contract_failure_synthesizes_non_retry_prompt():
    payload = validate_phase_output(
        "reflect",
        {
            "summary": "reflect failed validation",
            "outcome": "failed",
            "review": "# Review\n\nThis is a Thoth receipt contract issue, not a project-code issue.",
        },
        prior_validate_payload={
            "summary": "Official validation evidence failed: stdout_evidence_present",
            "passed": False,
            "metric_name": "checks",
            "metric_value": 1,
            "threshold": 1,
            "runtime_contract_health": "runtime_contract_error",
            "failure_class": "runtime_contract_error",
            "checks": [
                {"name": "stdout_evidence_present", "ok": False, "detail": "stdout evidence missing"},
            ],
        },
    )

    assert payload["outcome"] == "failed"
    assert payload["retry_authorized"] is False
    assert "Do not retry execute" in payload["corrective_prompt"]
    assert "project code" in payload["corrective_prompt"]
    assert "failure_class" not in payload
    assert "root_cause" not in payload
    assert any(item["field"] == "reflect.corrective_prompt" for item in payload["_normalization_warnings"])


def test_runtime_validate_mechanically_confirms_execute_receipt_without_worker(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Mechanical validate demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Mechanical validate demo",
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "threshold": 1},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="mechanically validate receipt",
    )
    calls: list[str] = []

    class ReceiptDriver:
        def execute_phase(self, *, handle, phase_packet):
            phase = phase_packet["phase"]
            calls.append(phase)
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                return {**_execute_payload(), "official_validation_receipt": _receipt_payload(handle, passed=True)}
            if phase == "reflect":
                return {
                    "summary": "reflect passed",
                    "outcome": "passed",
                    "review": "# Review\n\nThe receipt passed; close the run.",
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=ReceiptDriver())

    assert status == 0
    assert calls == ["plan", "execute", "reflect"]
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    assert validate_payload["passed"] is True
    assert validate_payload["official_validation_receipt"]["python_executable"] == "/opt/conda/envs/thoth-demo/bin/python"
    assert "official_command_matches" in {check["name"] for check in validate_payload["checks"]}


def test_runtime_validate_normalizes_inline_receipt_logs_and_preserves_metric(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Inline receipt demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Inline receipt demo",
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "bitwise_identical", "direction": "gte", "threshold": 1.0},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="normalize inline validator logs",
    )

    class InlineReceiptDriver:
        def execute_phase(self, *, handle, phase_packet):
            phase = phase_packet["phase"]
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                return {
                    **_execute_payload(),
                    "official_validation_receipt": _inline_receipt_payload(metric_value=1.0),
                }
            if phase == "reflect":
                return {
                    "summary": "reflect passed",
                    "outcome": "passed",
                    "review": "# Review\n\nThe inline receipt was normalized and passed.",
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=InlineReceiptDriver())

    assert status == 0
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    assert validate_payload["passed"] is True
    assert validate_payload["metric_name"] == "bitwise_identical"
    assert validate_payload["metric_value"] == 1.0
    assert validate_payload["runtime_contract_health"] == "ok"
    receipt = validate_payload["official_validation_receipt"]
    assert Path(receipt["stdout_log_path"]).exists()
    assert Path(receipt["stderr_log_path"]).exists()
    assert "3 passed" in Path(receipt["stdout_log_path"]).read_text(encoding="utf-8")
    assert validate_payload["_normalization_warnings"]
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["result"]["metrics"]["bitwise_identical"] == 1.0
    assert run_result["result"]["observed_validation"]["metric_threshold_met"] is True


def test_runtime_validate_accepts_compact_receipt_aliases_and_prunes_output(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Alias receipt demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Alias receipt demo",
            "eval_entrypoint": {"command": "python -m pytest tests/test_demo.py -v"},
            "primary_metric": {"name": "score", "direction": "gte", "threshold": 0.9},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="normalize natural receipt aliases",
    )

    class AliasReceiptDriver:
        def execute_phase(self, *, handle, phase_packet):
            phase = phase_packet["phase"]
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                return {
                    **_execute_payload(),
                    "official_validation_receipt": {
                        "actual_command": "python -m pytest tests/test_demo.py -v",
                        "exit_code": 0,
                        "passed": True,
                        "metric": {"name": "score", "value": 0.93, "direction": "gte", "threshold": 0.9},
                        "stdout": "============================= test session starts =============================\n1 passed\n",
                        "stderr": "[empty stderr captured]",
                        "checks_summary": ["raw worker-only detail should not be persisted"],
                        "extra_agent_note": "raw receipt detail should be pruned",
                    },
                }
            if phase == "reflect":
                return {
                    "summary": "reflect passed",
                    "outcome": "passed",
                    "review": "# Review\n\nThe alias receipt was normalized and passed.",
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=AliasReceiptDriver())

    assert status == 0
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    receipt = validate_payload["official_validation_receipt"]
    assert validate_payload["passed"] is True
    assert validate_payload["metric_value"] == 0.93
    assert receipt["command"] == "python -m pytest tests/test_demo.py -v"
    assert receipt["metric_value"] == 0.93
    assert receipt["metric_name"] == "score"
    assert Path(receipt["stdout_log_path"]).exists()
    assert Path(receipt["stderr_log_path"]).exists()
    assert "stdout" not in receipt
    assert "stderr" not in receipt
    assert "actual_command" not in receipt
    assert "checks_summary" not in receipt
    assert "extra_agent_note" not in receipt
    assert any(
        item["field"] == "official_validation_receipt.actual_command"
        and item["reason"] == "alias_normalized"
        for item in validate_payload["_normalization_warnings"]
    )
    assert any(
        item["field"] == "official_validation_receipt.metric.value"
        and item["canonical_field"] == "metric_value"
        for item in validate_payload["_normalization_warnings"]
    )


def test_runtime_validate_accepts_environment_adjusted_reference_command(tmp_path):
    project = _prepare_project(tmp_path)
    reference_command = "python -m pytest src/demo_project/tests/test_t0_2_vit.py -v"
    actual_command = "CUDA_VISIBLE_DEVICES=3 python -m pytest src/demo_project/tests/test_t0_2_vit.py -v"
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Environment adjusted validator demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Environment adjusted validator demo",
            "eval_entrypoint": {"command": reference_command},
            "primary_metric": {"name": "bitwise_identical", "direction": "gte", "threshold": 1.0},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="accept environment adjusted official validation",
    )

    class EnvAdjustedReceiptDriver:
        def execute_phase(self, *, handle, phase_packet):
            phase = phase_packet["phase"]
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                return {
                    **_execute_payload(),
                    "official_validation_receipt": _inline_receipt_payload(command=actual_command, metric_value=1.0),
                }
            if phase == "reflect":
                return {
                    "summary": "reflect passed",
                    "outcome": "passed",
                    "review": "# Review\n\nThe GPU-selected validator evidence is sufficient.",
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=EnvAdjustedReceiptDriver())

    assert status == 0
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    assert validate_payload["passed"] is True
    assert validate_payload["runtime_contract_health"] == "ok"
    assert validate_payload["acceptance_state"] == "validated"
    observed = validate_payload["observed_validation"]
    assert observed["command_matches"] is False
    assert observed["command_relation"] == "environment_adjusted"
    assert observed["validator_intent_preserved"] is True
    command_check = next(check for check in validate_payload["checks"] if check["name"] == "official_command_matches")
    assert command_check["ok"] is False
    assert command_check["blocking"] is False


def test_runtime_validate_rejects_obvious_pytest_target_drift(tmp_path):
    project = _prepare_project(tmp_path)
    reference_command = "python -m pytest src/demo_project/tests/test_t0_2_vit.py -v"
    actual_command = "CUDA_VISIBLE_DEVICES=3 python -m pytest src/demo_project/tests/test_other.py -v"
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Target drift validator demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Target drift validator demo",
            "eval_entrypoint": {"command": reference_command},
            "primary_metric": {"name": "bitwise_identical", "direction": "gte", "threshold": 1.0},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="reject target drift",
    )

    class TargetDriftReceiptDriver:
        def execute_phase(self, *, handle, phase_packet):
            phase = phase_packet["phase"]
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                return {
                    **_execute_payload(),
                    "official_validation_receipt": _inline_receipt_payload(command=actual_command, metric_value=1.0),
                }
            if phase == "reflect":
                return {
                    "summary": "reflect failed",
                    "outcome": "failed",
                    "review": "# Review\n\nThe receipt did not preserve the official pytest target.",
                    "corrective_prompt": "Run validation for the official pytest target and return evidence.",
                    "retry_authorized": False,
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=TargetDriftReceiptDriver())

    assert status == 1
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    assert validate_payload["passed"] is False
    assert validate_payload["failure_class"] == "evidence_insufficient"
    assert validate_payload["acceptance_state"] == "needs_human_review"
    observed = validate_payload["observed_validation"]
    assert observed["validator_intent_preserved"] is False
    assert "expected pytest target not covered" in observed["validator_drift_reason"]


def test_runtime_validate_does_not_treat_missing_stdout_path_as_inline_log(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Missing stdout path demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Missing stdout path demo",
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "threshold": 1},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="do not convert a missing path into proof",
    )

    class MissingStdoutPathDriver:
        def execute_phase(self, *, handle, phase_packet):
            phase = phase_packet["phase"]
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                return {
                    **_execute_payload(),
                    "official_validation_receipt": {
                        "command": "pytest -q",
                        "cwd": str(project),
                        "python_executable": "/opt/conda/bin/python",
                        "exit_code": 0,
                        "passed": True,
                        "metric_value": 1,
                        "checks_summary": ["passed"],
                        "stdout_log_path": ".thoth/runs/run-missing/missing.stdout.log",
                        "stderr_log": "[empty stderr captured]",
                    },
                }
            if phase == "reflect":
                return {
                    "summary": "reflect failed",
                    "outcome": "failed",
                    "review": "# Review\n\nThe validate phase failed on missing stdout evidence.",
                    "corrective_prompt": "Fix the runtime receipt contract; do not edit project code for this evidence-path failure.",
                    "retry_authorized": False,
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=MissingStdoutPathDriver())

    assert status == 1
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    assert validate_payload["runtime_contract_health"] == "runtime_contract_error"
    assert any(check["name"] == "stdout_evidence_present" and check["ok"] is False for check in validate_payload["checks"])
    assert not (handle.run_dir / "worker-logs" / "official-validator.stdout.log").exists()


def test_runtime_contract_error_does_not_retry_execute_from_reflect(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Runtime contract demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Runtime contract demo",
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "threshold": 1},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="do not retry execute for receipt hygiene",
    )
    calls: list[str] = []

    class MissingStdoutDriver:
        def execute_phase(self, *, handle, phase_packet):
            phase = phase_packet["phase"]
            calls.append(phase)
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                return {
                    **_execute_payload(),
                    "official_validation_receipt": {
                        "command": "pytest -q",
                        "cwd": str(project),
                        "python_executable": "/opt/conda/bin/python",
                        "exit_code": 0,
                        "passed": True,
                        "metric_value": 1,
                        "checks_summary": ["passed"],
                        "stderr_log": "[empty stderr captured]",
                    },
                }
            if phase == "reflect":
                return {
                    "summary": "reflect failed",
                    "outcome": "failed",
                    "review": "# Review\n\nThe validate phase failed on receipt evidence.",
                    "corrective_prompt": "Fix the runtime receipt contract; do not edit project code for this evidence-path failure.",
                    "retry_authorized": False,
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=MissingStdoutDriver())

    assert status == 1
    assert calls == ["plan", "execute", "reflect"]
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    assert validate_payload["runtime_contract_health"] == "runtime_contract_error"
    reflect_payload = json.loads((handle.run_dir / "reflect.json").read_text(encoding="utf-8"))
    assert reflect_payload["retry_authorized"] is False
    assert "do not edit project code" in reflect_payload["corrective_prompt"]


def test_reflect_feedback_retries_execute_once_inside_single_run(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Reflect retry demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Reflect retry demo",
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "threshold": 1},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="retry after reflect feedback",
    )
    execute_count = 0
    calls: list[str] = []

    class RetryDriver:
        def execute_phase(self, *, handle, phase_packet):
            nonlocal execute_count
            phase = phase_packet["phase"]
            calls.append(phase)
            if phase == "plan":
                return _plan_payload()
            if phase == "execute":
                execute_count += 1
                passed = execute_count == 2
                return {
                    **_execute_payload(f"exec attempt {execute_count}"),
                    "official_validation_receipt": _receipt_payload(handle, passed=passed),
                }
            if phase == "reflect":
                validate_path = phase_packet["prior_artifacts"]["validate"]
                validate_payload = json.loads(Path(validate_path).read_text(encoding="utf-8"))
                if validate_payload["passed"]:
                    return {
                        "summary": "reflect passed",
                        "outcome": "passed",
                        "review": "# Review\n\nThe retry validator passed.",
                    }
                return {
                    "summary": "reflect failed",
                    "outcome": "failed",
                    "review": "# Review\n\nThe first official validator receipt failed.",
                    "corrective_prompt": "Repair implementation and rerun the official validator.",
                    "retry_authorized": True,
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=RetryDriver())

    assert status == 0
    assert calls == ["plan", "execute", "reflect", "execute", "reflect"]
    phase_state = json.loads((handle.run_dir / "phase_state.json").read_text(encoding="utf-8"))
    attempts = phase_state["reflect_feedback"]["attempts"]
    assert len(attempts) == 1
    assert attempts[0]["guidance_id"].startswith("guide-")
    assert (handle.run_dir / "phase-retries" / "retry-1" / "validate.json").exists()
    guidance = (handle.run_dir / "guidance.jsonl").read_text(encoding="utf-8")
    assert "reflect_feedback" in guidance


def test_execute_worker_has_no_default_timeout_from_run_payload(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Timeout policy demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Timeout policy demo"},
        goal="execute should not inherit loop budget",
    )
    submit_phase_output(project, handle.run_id, phase="plan", payload=_plan_payload())
    phase_packet = next_phase_payload(project, handle.run_id)
    driver = ExternalWorkerPhaseDriver(executor="codex", run_payload={"max_runtime_seconds": 1})

    assert driver._timeout_for_phase("execute", phase_packet) is None


def test_external_worker_archives_invalid_attempt_before_retry(monkeypatch, tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Retry demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Retry demo"},
        goal="retry bad worker output",
    )
    phase_packet = next_phase_payload(project, handle.run_id)
    output_path = handle.run_dir / "plan.worker-output.json"
    prompts: list[str] = []

    def _fake_process(command, handle, phase, stdout_path, stderr_path, env, timeout_seconds):
        prompts.append(command[-1])
        stdout_path.write_text(f"attempt {len(prompts)} stdout\n", encoding="utf-8")
        stderr_path.write_text(f"attempt {len(prompts)} stderr\n", encoding="utf-8")
        if len(prompts) == 1:
            output_path.write_text(
                json.dumps(
                    {
                        "summary": "plan bad",
                        "authority_complete": "yes",
                        "open_gaps": [],
                        "history_action": "continue",
                        "plan": "# Plan\n\nRun pytest.",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
        else:
            output_path.write_text(
                json.dumps(
                    {
                        "summary": "plan ok",
                        "authority_complete": True,
                        "open_gaps": [],
                        "history_action": "continue",
                        "plan": "# Plan\n\nRun pytest.",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
        return 0

    monkeypatch.setattr("thoth.run.worker._run_phase_worker_process", _fake_process)
    driver = ExternalWorkerPhaseDriver(executor="codex", timeout_seconds=5)
    payload = driver.execute_phase(handle=handle, phase_packet=phase_packet)

    assert payload["summary"] == "plan ok"
    assert len(prompts) == 2
    assert "Previous output failed validation: plan.authority_complete must be a boolean" in prompts[1]
    invalid_output = handle.run_dir / "worker-invalid" / "plan.attempt-1.worker-output.json"
    validation_error = handle.run_dir / "worker-invalid" / "plan.attempt-1.validation-error.txt"
    archived_stdout = handle.run_dir / "worker-invalid" / "plan.attempt-1.stdout.log"
    assert invalid_output.exists()
    assert validation_error.exists()
    assert archived_stdout.read_text(encoding="utf-8").strip() == "attempt 1 stdout"
    assert "plan.authority_complete must be a boolean" in validation_error.read_text(encoding="utf-8")
    assert json.loads(output_path.read_text(encoding="utf-8"))["summary"] == "plan ok"
    artifacts = json.loads((handle.run_dir / "artifacts.json").read_text(encoding="utf-8"))["artifacts"]
    assert any(row["kind"] == "invalid_worker_output" and row["path"] == str(invalid_output) for row in artifacts)
    assert any(row["kind"] == "worker_validation_error" and row["path"] == str(validation_error) for row in artifacts)


def test_external_worker_archives_stale_output_outside_invalid_dir(monkeypatch, tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Stale output demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Stale output demo"},
        goal="archive stale canonical output cleanly",
    )
    phase_packet = next_phase_payload(project, handle.run_id)
    output_path = handle.run_dir / "plan.worker-output.json"
    output_path.write_text(json.dumps({"summary": "stale"}) + "\n", encoding="utf-8")

    def _fake_process(command, handle, phase, stdout_path, stderr_path, env, timeout_seconds):
        output_path.write_text(json.dumps(_plan_payload("fresh plan")) + "\n", encoding="utf-8")
        stdout_path.write_text("fresh stdout\n", encoding="utf-8")
        stderr_path.write_text("", encoding="utf-8")
        return 0

    monkeypatch.setattr("thoth.run.worker._run_phase_worker_process", _fake_process)
    driver = ExternalWorkerPhaseDriver(executor="codex", timeout_seconds=5)
    payload = driver.execute_phase(handle=handle, phase_packet=phase_packet)

    assert payload["summary"] == "fresh plan"
    archived_output = handle.run_dir / "worker-archived" / "plan.attempt-1.worker-output.json"
    assert archived_output.exists()
    assert not (handle.run_dir / "worker-invalid" / "plan.attempt-1.worker-output.json").exists()
    artifacts = json.loads((handle.run_dir / "artifacts.json").read_text(encoding="utf-8"))["artifacts"]
    assert any(row["kind"] == "worker_stale_output" and row["path"] == str(archived_output) for row in artifacts)
    assert not any(row["kind"] == "invalid_worker_output" and row["path"] == str(archived_output) for row in artifacts)


def test_external_worker_timeout_reports_phase_worker_timeout_and_tails(monkeypatch, tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Timeout demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Timeout demo"},
        goal="timeout bad worker output",
    )
    phase_packet = next_phase_payload(project, handle.run_id)

    def _fake_timeout(command, handle, phase, stdout_path, stderr_path, env, timeout_seconds):
        stdout_path.write_text("worker still thinking\n", encoding="utf-8")
        stderr_path.write_text("no output yet\n", encoding="utf-8")
        raise subprocess.TimeoutExpired(command, timeout_seconds)

    monkeypatch.setattr("thoth.run.worker._run_phase_worker_process", _fake_timeout)
    driver = ExternalWorkerPhaseDriver(executor="codex", timeout_seconds=5)
    try:
        driver.execute_phase(handle=handle, phase_packet=phase_packet)
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("expected phase worker timeout")

    assert "phase_worker_timeout" in message
    assert "worker still thinking" in message
    assert "no output yet" in message
    validation_error = handle.run_dir / "worker-invalid" / "plan.attempt-1.validation-error.txt"
    assert validation_error.exists()
    assert "phase_worker_timeout" in validation_error.read_text(encoding="utf-8")


def test_external_worker_final_schema_failure_mentions_invalid_artifacts(monkeypatch, tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Final invalid demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Final invalid demo"},
        goal="preserve invalid worker output",
    )
    phase_packet = next_phase_payload(project, handle.run_id)
    attempts = 0

    def _fake_invalid(command, handle, phase, stdout_path, stderr_path, env, timeout_seconds):
        nonlocal attempts
        attempts += 1
        (handle.run_dir / "plan.worker-output.json").write_text(
            json.dumps({"summary": "missing required fields"}) + "\n",
            encoding="utf-8",
        )
        stdout_path.write_text(f"attempt {attempts}\n", encoding="utf-8")
        stderr_path.write_text("", encoding="utf-8")
        return 0

    monkeypatch.setattr("thoth.run.worker._run_phase_worker_process", _fake_invalid)
    driver = ExternalWorkerPhaseDriver(executor="codex", timeout_seconds=5)
    try:
        driver.execute_phase(handle=handle, phase_packet=phase_packet)
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("expected final schema failure")

    invalid_output = handle.run_dir / "worker-invalid" / "plan.attempt-2.worker-output.json"
    validation_error = handle.run_dir / "worker-invalid" / "plan.attempt-2.validation-error.txt"
    assert attempts == 2
    assert invalid_output.exists()
    assert validation_error.exists()
    assert f"invalid_output={invalid_output}" in message
    assert f"validation_error={validation_error}" in message
    assert "plan output missing required fields" in message


def test_external_worker_uses_phase_specific_default_timeouts(monkeypatch, tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Timeout defaults",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={
            "work_id": "task-1",
            "title": "Timeout defaults",
            "eval_entrypoint": {"command": "pytest -q"},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="check timeout defaults",
    )
    seen: list[tuple[str, float | None]] = []

    def _fake_process(command, handle, phase, stdout_path, stderr_path, env, timeout_seconds):
        seen.append((phase, timeout_seconds))
        output_path = handle.run_dir / f"{phase}.worker-output.json"
        payload = _execute_payload() if phase == "execute" else _plan_payload()
        output_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        stdout_path.write_text("", encoding="utf-8")
        stderr_path.write_text("", encoding="utf-8")
        return 0

    monkeypatch.setattr("thoth.run.worker._run_phase_worker_process", _fake_process)
    driver = ExternalWorkerPhaseDriver(executor="codex")
    plan_packet = next_phase_payload(project, handle.run_id)
    plan_payload = driver.execute_phase(handle=handle, phase_packet=plan_packet)
    submit_phase_output(project, handle.run_id, phase="plan", payload=plan_payload)
    execute_packet = next_phase_payload(project, handle.run_id)
    driver.execute_phase(handle=handle, phase_packet=execute_packet)

    assert seen == [("plan", 900.0), ("execute", None)]


def test_runtime_driver_stop_during_phase_writes_stopped_attempt(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Stop demo",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"work_id": "task-1", "title": "Stop demo", "eval_entrypoint": {"command": "pytest -q"}},
        goal="stop cleanly",
    )

    class StopDriver:
        def execute_phase(self, *, handle, phase_packet):
            _update_state(handle, status="stopping", phase="stopping", supervisor_state="stopping")
            raise InterruptedError("stop requested")

    status = execute_runtime_controller(project, handle.run_id, driver=StopDriver())

    assert status == 0
    state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert state["status"] == "stopped"
    assert result["status"] == "stopped"


def test_external_worker_command_uses_executor_specific_cli(tmp_path):
    project = _prepare_project(tmp_path)
    codex_cmd = external_worker_command("codex", project, "prompt", phase="execute")
    claude_cmd = external_worker_command("claude", project, "prompt", phase="execute")
    assert codex_cmd[:5] == ["codex", "exec", "-m", "gpt-5.4", "--json"]
    assert "--dangerously-bypass-approvals-and-sandbox" in codex_cmd
    assert "-C" in codex_cmd
    assert str(project) in codex_cmd
    assert claude_cmd[:2] == ["claude", "-p"]
    assert "--dangerously-skip-permissions" in claude_cmd


def test_plan_sandbox_but_execute_is_gpu_capable(tmp_path):
    project = _prepare_project(tmp_path)
    codex_plan = external_worker_command("codex", project, "prompt", phase="plan")
    codex_execute = external_worker_command("codex", project, "prompt", phase="execute")
    claude_execute = external_worker_command("claude", project, "prompt", phase="execute")
    assert ["--sandbox", "workspace-write"] == codex_plan[codex_plan.index("--sandbox") : codex_plan.index("--sandbox") + 2]
    assert "--dangerously-bypass-approvals-and-sandbox" in codex_execute
    assert "--dangerously-skip-permissions" in claude_execute
    assert "--disallowed-tools" not in claude_execute
