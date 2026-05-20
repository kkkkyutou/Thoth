"""Tests for Thoth internal runtime protocol helpers."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from thoth.prompt_validators import validate_phase_output
from thoth.prompt_specs import phase_prompt_authority
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


def test_plan_and_reflect_summary_budget_is_800():
    assert phase_prompt_authority("plan")["summary_budget_utf8"] == 800
    assert phase_prompt_authority("reflect")["summary_budget_utf8"] == 800
    assert phase_prompt_authority("execute")["summary_budget_utf8"] == 240
    assert phase_prompt_authority("validate")["summary_budget_utf8"] == 240


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
    assert len(prompt) < 5800


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
    assert plan_packet["phase_authority"]["objective"].startswith("Produce the concrete execution plan")
    assert plan_packet["phase_authority"]["summary_budget_utf8"] == 800

    submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload=_plan_payload(),
    )
    execute_packet = next_phase_payload(project, handle.run_id)
    assert execute_packet["phase"] == "execute"
    assert execute_packet["phase_authority"]["objective"] != plan_packet["phase_authority"]["objective"]
    assert execute_packet["phase_authority"]["summary_budget_utf8"] == 240


def test_phase_output_rejects_overlong_summary(tmp_path):
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
    too_long = "x" * 801
    try:
        submit_phase_output(
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
    except ValueError as exc:
        assert "plan.summary exceeds 800 UTF-8 bytes" in str(exc)
    else:
        raise AssertionError("expected summary budget failure")


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

    def _fake_process(command, handle, stdout_path, stderr_path, env, timeout_seconds):
        prompts.append(command[-1])
        stdout_path.write_text(f"attempt {len(prompts)} stdout\n", encoding="utf-8")
        stderr_path.write_text(f"attempt {len(prompts)} stderr\n", encoding="utf-8")
        if len(prompts) == 1:
            output_path.write_text(
                json.dumps(
                    {
                        "summary": "x" * 801,
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
    assert "Previous output failed validation: plan.summary exceeds 800 UTF-8 bytes" in prompts[1]
    invalid_output = handle.run_dir / "worker-invalid" / "plan.attempt-1.worker-output.json"
    validation_error = handle.run_dir / "worker-invalid" / "plan.attempt-1.validation-error.txt"
    archived_stdout = handle.run_dir / "worker-invalid" / "plan.attempt-1.stdout.log"
    assert invalid_output.exists()
    assert validation_error.exists()
    assert archived_stdout.read_text(encoding="utf-8").strip() == "attempt 1 stdout"
    assert "plan.summary exceeds 800 UTF-8 bytes" in validation_error.read_text(encoding="utf-8")
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

    def _fake_timeout(command, handle, stdout_path, stderr_path, env, timeout_seconds):
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

    def _fake_invalid(command, handle, stdout_path, stderr_path, env, timeout_seconds):
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

    def _fake_process(command, handle, stdout_path, stderr_path, env, timeout_seconds):
        phase = "execute" if any("execute.worker-output.json" in str(item) for item in command) else "plan"
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


def test_plan_and_validate_worker_commands_use_workspace_sandbox(tmp_path):
    project = _prepare_project(tmp_path)
    codex_plan = external_worker_command("codex", project, "prompt", phase="plan")
    codex_validate = external_worker_command("codex", project, "prompt", phase="validate")
    claude_validate = external_worker_command("claude", project, "prompt", phase="validate")
    assert ["--sandbox", "workspace-write"] == codex_plan[codex_plan.index("--sandbox") : codex_plan.index("--sandbox") + 2]
    assert ["--sandbox", "workspace-write"] == codex_validate[codex_validate.index("--sandbox") : codex_validate.index("--sandbox") + 2]
    assert "--disallowed-tools" in claude_validate
