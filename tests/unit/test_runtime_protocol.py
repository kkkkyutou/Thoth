"""Tests for Thoth internal runtime protocol helpers."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from thoth.prompt_validators import utf8_len, validate_phase_output
from thoth.prompt_specs import phase_prompt_authority
from thoth.objects import Store
from thoth.run.driver import execute_runtime_controller
from thoth.run.ledger import (
    _update_state,
    append_protocol_event,
    complete_run,
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
        "authority_coverage": {"goal": True, "acceptance": True},
        "open_gaps": [],
        "forbidden_assumptions_used": [],
        "execution_steps": ["edit", "test"],
        "files_expected": [],
        "commands_expected": ["pytest -q"],
        "validation_plan": "run pytest",
        "risk_assessment": "low risk",
    }


def _execute_payload(summary: str = "exec ok") -> dict:
    return {
        "summary": summary,
        "plan_artifact_read": True,
        "plan_deviations": [],
        "files_touched": [],
        "commands_run": [],
        "artifacts": [],
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


def test_plan_gap_schema_drift_normalizes_jsonish_items():
    payload = {
        **_plan_payload("authority incomplete"),
        "authority_complete": False,
        "open_gaps": [{"field": "authority_context", "reason": "empty"}],
        "forbidden_assumptions_used": [None, False, 3],
    }

    normalized = validate_phase_output("plan", payload)

    assert normalized["open_gaps"] == ['{"field":"authority_context","reason":"empty"}']
    assert normalized["forbidden_assumptions_used"] == ["null", "false", "3"]
    assert normalized["_normalization_warnings"][0]["field"] == "plan.open_gaps"
    assert normalized["_normalization_warnings"][0]["reason"] == "coerced_to_json_string"


def test_plan_discovery_tasks_do_not_trigger_authority_gap():
    payload = {
        **_plan_payload("discover source paths"),
        "discovery_tasks": ["locate TRELLIS2 source tree", "create missing target test file"],
    }

    normalized = validate_phase_output("plan", payload)

    assert normalized["discovery_tasks"] == ["locate TRELLIS2 source tree", "create missing target test file"]
    assert normalized["open_gaps"] == []


def test_phase_summary_budgets_are_relaxed():
    assert phase_prompt_authority("plan")["summary_budget_utf8"] == 1200
    assert phase_prompt_authority("reflect")["summary_budget_utf8"] == 1200
    assert phase_prompt_authority("execute")["summary_budget_utf8"] == 800
    assert phase_prompt_authority("validate")["summary_budget_utf8"] == 800


def test_plan_long_fields_normalize_without_schema_failure():
    long_text = "x" * 1500
    payload = {
        **_plan_payload(long_text),
        "open_gaps": [long_text],
        "forbidden_assumptions_used": [{"reason": long_text}],
        "execution_steps": [long_text],
        "files_expected": [long_text],
        "commands_expected": [long_text],
        "validation_plan": long_text,
        "risk_assessment": {"summary": long_text},
    }

    normalized = validate_phase_output("plan", payload)

    assert utf8_len(normalized["summary"]) <= 1200
    assert utf8_len(normalized["open_gaps"][0]) <= 1024
    assert utf8_len(normalized["execution_steps"][0]) <= 1024
    assert utf8_len(normalized["commands_expected"][0]) <= 1024
    assert utf8_len(normalized["validation_plan"]) <= 1200
    assert utf8_len(normalized["risk_assessment"]["summary"]) <= 1200
    warning_fields = {row["field"] for row in normalized["_normalization_warnings"]}
    assert "plan.validation_plan" in warning_fields
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
    assert "temporary execution guidance" in phase["guidance"]["current"]["policy"]["semantics"]


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
            "plan_deviations": [long_text],
            "files_touched": [long_text],
            "commands_run": [long_text],
            "artifacts": [{"path": long_text}],
            "official_validation_receipt": {"command": long_text, "passed": True},
        },
    )
    assert utf8_len(execute["summary"]) <= 800
    assert utf8_len(execute["commands_run"][0]) <= 1024
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
            "outcome": "failed",
            "residual_risks": [long_text],
            "evidence": [long_text],
            "next_recommendation": long_text,
            "failure_class": "runtime_drift",
            "root_cause": long_text,
            "next_plan_hint": long_text,
        },
    )
    assert utf8_len(reflect["summary"]) <= 1200
    assert utf8_len(reflect["root_cause"]) <= 1200
    assert utf8_len(reflect["next_plan_hint"]) <= 1200
    assert utf8_len(reflect["corrective_prompt"]) <= 2000
    assert reflect["retry_authorized"] is True
    assert reflect["_normalization_warnings"]


def test_mechanical_phase_fields_remain_strict():
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

    try:
        validate_phase_output(
            "reflect",
            {
                "summary": "reflect",
                "outcome": "failed",
                "residual_risks": [],
                "evidence": [],
                "next_recommendation": "retry",
                "failure_class": "x" * 40,
                "root_cause": "validator failed",
                "next_plan_hint": "fix implementation",
            },
        )
    except ValueError as exc:
        assert "reflect.failure_class exceeds 32 UTF-8 bytes" in str(exc)
    else:
        raise AssertionError("reflect.failure_class should remain a strict short label")


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
    handle, _packet = prepare_execution(
        project,
        command_id="review",
        title="Review demo",
        work_id=None,
        host="claude",
        executor="claude",
        sleep_requested=False,
        target="src/app.py",
        goal="review app",
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


def test_review_packet_includes_exact_completion_command_when_expectation_is_frozen(tmp_path):
    project = _prepare_project(tmp_path)
    handle, packet = prepare_execution(
        project,
        command_id="review",
        title="Review demo",
        work_id="task-review-probe",
        host="claude",
        executor="codex",
        sleep_requested=False,
        target="tracker/review_probe.py",
        goal="review app",
        strict_task={
            "work_id": "task-review-probe",
            "review_expectation": {
                "summary": "1 issue",
                "findings": [
                    {
                        "severity": "high",
                        "title": "Empty title accepted",
                        "path": "tracker/review_probe.py",
                        "line": 4,
                        "summary": "Blank titles are persisted as valid task state.",
                    }
                ],
            },
        },
    )

    exact_command = packet["protocol_commands"]["complete_exact"]
    assert handle.run_id in exact_command
    assert "--summary" in exact_command
    assert "--result-json" in exact_command
    assert "--checks-json" in exact_command
    assert "review_exact_match" in exact_command
    assert "Empty title accepted" in exact_command


def test_review_completion_dedupes_duplicate_findings(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="review",
        title="Review demo",
        work_id=None,
        host="claude",
        executor="claude",
        sleep_requested=False,
        target="src/app.py",
        goal="review app",
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
    assert "Do not invoke `$thoth run`, `$thoth loop`, or `$thoth review`." in prompt
    assert "\"max_iterations\": 10" in prompt
    assert "pytest -q tests/test_demo.py" in prompt
    assert "Runtime driver capture path" in prompt
    assert "Summary budget UTF-8 bytes" in prompt
    assert len(json.dumps(packet, ensure_ascii=False)) < 4200
    assert len(prompt) < 7000


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
    assert plan_packet["phase_authority"]["objective"].startswith("Act as top-level planner")
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
            "authority_coverage": {"goal": True},
            "open_gaps": [],
            "forbidden_assumptions_used": [],
            "execution_steps": ["edit"],
            "files_expected": [],
            "commands_expected": [],
            "validation_plan": "run pytest",
            "risk_assessment": "low risk",
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
    assert "Role: senior implementation engineer." in prompt
    assert "Repo-local dependency repair is allowed" in prompt
    assert "Optional structured fields for human dashboards" in prompt


def test_execute_output_accepts_structured_debug_fields():
    payload = validate_phase_output(
        "execute",
        {
            "summary": "execute done",
            "plan_artifact_read": True,
            "plan_deviations": [],
            "files_touched": [],
            "commands_run": [],
            "artifacts": [],
            "debug_attempts": [{"name": "flex_gemm import", "status": "fixed"}],
            "dependency_actions": [{"package": "flex_gemm", "scope": ".vendor"}],
            "verification_steps": [{"command": "pytest -k flex_gemm", "passed": True}],
            "resolved_failures": ["ModuleNotFoundError: flex_gemm"],
            "remaining_failures": [],
        },
    )

    assert payload["debug_attempts"][0]["name"] == "flex_gemm import"
    assert payload["dependency_actions"][0]["scope"] == ".vendor"


def test_reflect_failure_fields_are_synthesized_from_validate_evidence():
    payload = validate_phase_output(
        "reflect",
        {
            "summary": "reflect failed validation",
            "outcome": "failed",
            "residual_risks": [],
            "evidence": ["validate failed"],
            "next_recommendation": "repair dependency",
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

    assert payload["failure_class"] == "dependency_missing"
    assert "flex_gemm" in payload["root_cause"]
    assert "test_flex_gemm" in payload["next_plan_hint"]
    assert payload["retry_authorized"] is True
    assert payload["retry_target"] == "execute"
    assert "official validator" in payload["corrective_prompt"]
    assert any(item["field"] == "reflect.failure_class" for item in payload["_normalization_warnings"])


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
                    "residual_risks": [],
                    "evidence": ["receipt passed"],
                    "next_recommendation": "close run",
                }
            raise AssertionError(f"unexpected worker phase {phase}")

    status = execute_runtime_controller(project, handle.run_id, driver=ReceiptDriver())

    assert status == 0
    assert calls == ["plan", "execute", "reflect"]
    validate_payload = json.loads((handle.run_dir / "validate.json").read_text(encoding="utf-8"))
    assert validate_payload["passed"] is True
    assert validate_payload["official_validation_receipt"]["python_executable"] == "/opt/conda/envs/thoth-demo/bin/python"
    assert "official_command_matches" in {check["name"] for check in validate_payload["checks"]}


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
                    "commands_run": ["pytest -q"],
                    "official_validation_receipt": _receipt_payload(handle, passed=passed),
                }
            if phase == "reflect":
                validate_path = phase_packet["prior_artifacts"]["validate"]
                validate_payload = json.loads(Path(validate_path).read_text(encoding="utf-8"))
                if validate_payload["passed"]:
                    return {
                        "summary": "reflect passed",
                        "outcome": "passed",
                        "residual_risks": [],
                        "evidence": ["retry validator passed"],
                        "next_recommendation": "close run",
                    }
                return {
                    "summary": "reflect failed",
                    "outcome": "failed",
                    "residual_risks": ["validator failed"],
                    "evidence": ["official receipt failed"],
                    "next_recommendation": "continue implementation",
                    "failure_class": "checks",
                    "root_cause": "first official validator receipt failed",
                    "next_plan_hint": "repair implementation and rerun official validator",
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
                        "authority_coverage": {"goal": True},
                        "open_gaps": [],
                        "forbidden_assumptions_used": [],
                        "execution_steps": ["edit"],
                        "files_expected": [],
                        "commands_expected": [],
                        "validation_plan": "run pytest",
                        "risk_assessment": "low risk",
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
                        "authority_coverage": {"goal": True},
                        "open_gaps": [],
                        "forbidden_assumptions_used": [],
                        "execution_steps": ["edit"],
                        "files_expected": [],
                        "commands_expected": [],
                        "validation_plan": "run pytest",
                        "risk_assessment": "low risk",
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
