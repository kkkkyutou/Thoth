"""Tests for the official `$thoth` CLI surface."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from thoth.objects import Store
from thoth.plan.store import load_work_for_execution, upsert_work_item, upsert_decision
from thoth.run.controllers import create_auto_controller
from thoth.run.packets import prepare_execution
from thoth.run.phases import default_validate_output_schema


ROOT = Path(__file__).parent.parent.parent


def _run_cli(tmp_path: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    merged_env = dict(os.environ)
    existing = merged_env.get("PYTHONPATH", "")
    merged_env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    if env:
        merged_env.update(env)
    return subprocess.run(
        [sys.executable, "-m", "thoth.cli", *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=merged_env,
    )


def _write_task(
    project_dir: Path,
    work_id: str = "task-1",
    *,
    title: str = "Lifecycle Validation",
    work_goal: str = "State stays inspectable under real execution.",
    status: str = "ready",
    missing_questions: list[str] | None = None,
    module: str = "f1",
    direction: str = "frontend",
    eval_command: str = "pytest -q tests/unit/test_cli_surface.py",
) -> None:
    decision_id = f"DEC-{work_id}"
    upsert_decision(
        project_dir,
        {
            "schema_version": 1,
            "kind": "decision",
            "decision_id": decision_id,
            "scope_id": f"{module}-{work_id}",
            "question": "Which runtime validation method should be executed?",
            "candidate_method_ids": ["real-process-lifecycle"],
            "selected_values": {"candidate_method_id": "real-process-lifecycle"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    upsert_work_item(
        project_dir,
        {
            "schema_version": 1,
            "kind": "work_item",
            "work_id": work_id,
            "direction": direction,
            "module": module,
            "title": title,
            "status": status,
            "work_kind": "execution",
            "runnable": True,
            "goal": work_goal,
            "context": f"{module}-{work_id}",
            "constraints": ["temp-project"],
            "execution_plan": ["Create runtime packet.", "Observe protocol updates."],
            "eval_contract": {
                "entrypoint": {"command": eval_command},
                "primary_metric": {"name": "lifecycle_checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift"],
                "validate_output_schema": default_validate_output_schema(),
            },
            "runtime_policy": {"loop": {"max_iterations": 10, "max_runtime_seconds": 28800}},
            "decisions": [decision_id],
            "missing_questions": list(missing_questions or []),
        },
    )


def _extract_envelope(text: str) -> dict:
    start = text.find("{")
    if start < 0:
        raise AssertionError(f"No JSON object found in output: {text!r}")
    payload = json.loads(text[start:])
    if not isinstance(payload, dict):
        raise AssertionError(f"Expected object payload, got: {payload!r}")
    return payload


def _extract_json_object(text: str) -> dict:
    payload = _extract_envelope(text)
    body = payload.get("body")
    if isinstance(body, dict):
        if isinstance(body.get("packet"), dict):
            return body["packet"]
        if isinstance(body.get("status"), dict):
            return body["status"]
        if isinstance(body.get("doctor"), dict):
            return body["doctor"]
        if isinstance(body.get("result"), dict):
            return body["result"]
    return payload


def _jsonl_events(text: str) -> list[dict]:
    rows: list[dict] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def test_cli_init_creates_project_layer(tmp_path):
    result = _run_cli(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    assert (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()
    assert (tmp_path / ".thoth" / "docs" / "project.json").exists()
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / ".thoth" / "derived" / "codex-hooks.json").exists()


def test_cli_help_shows_minimal_public_commands(tmp_path):
    result = _run_cli(tmp_path, "--help")
    assert result.returncode == 0
    assert "{init,discuss,run,loop,review,auto,status,doctor,dashboard}" in result.stdout
    for hidden in (" sync", " report", " extend", " orchestration"):
        assert hidden not in result.stdout


def test_cli_discuss_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "planning", "note")
    assert result.returncode == 0
    discussions = list((tmp_path / ".thoth" / "objects" / "discussion").glob("*.json"))
    assert discussions, "Discuss should materialize an inquiring discussion object"
    payload = json.loads(discussions[-1].read_text(encoding="utf-8"))
    assert payload["kind"] == "discussion"
    assert payload["status"] == "inquiring"
    assert payload["payload"]["messages"][-1]["content"] == "planning note"
    envelope = json.loads(result.stdout)
    packet = envelope["body"]["packet"]
    assert packet["packet_kind"] == "discussion_authority"
    assert "record-discussion-authority" in packet["protocol_commands"]["close_authority"]


def test_cli_record_discussion_authority_closes_work(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "close", "this")
    discussion_id = json.loads(result.stdout)["body"]["discussion"]["discussion_id"]
    capsule_path = tmp_path / "authority.json"
    capsule_path.write_text(
        json.dumps(
            {
                "semantic_events": [
                    {
                        "event_type": "goal",
                        "source_summary": "关闭这个工作。",
                        "normalized_summary": "Close this work.",
                        "evidence_anchor": {"turn": "user-1"},
                        "affects": ["goal"],
                    }
                ],
                "goal": {"source_summary": "关闭这个工作。", "normalized_summary": "Close this work."},
                "constraints": ["temp-project"],
                "accepted_decisions": [
                    {
                        "decision_id": "DEC-close-work",
                        "question": "Close which work?",
                        "selected_values": {"work": "close-work"},
                        "status": "frozen",
                        "unresolved_gaps": [],
                    }
                ],
                "acceptance": {"normalized_summary": "pytest passes"},
                "open_questions": [],
                "completeness": {"is_closed": True},
                "work_item": {
                    "work_id": "close-work",
                    "title": "Close Work",
                    "status": "ready",
                    "work_kind": "execution",
                    "runnable": True,
                    "goal": "Close this work.",
                    "context": "test",
                    "constraints": ["temp-project"],
                    "execution_plan": ["Run validator."],
                    "eval_contract": {
                        "entrypoint": {"command": "pytest -q"},
                        "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
                        "failure_classes": ["runtime_drift"],
                        "validate_output_schema": default_validate_output_schema(),
                    },
                    "runtime_policy": {"loop": {"max_iterations": 1, "max_runtime_seconds": 60}},
                    "missing_questions": [],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    close = _run_cli(
        tmp_path,
        "record-discussion-authority",
        "--project-root",
        str(tmp_path),
        "--discussion-id",
        discussion_id,
        "--mode",
        "close",
        "--authority-json-file",
        str(capsule_path),
    )

    assert close.returncode == 0, close.stderr
    work_item = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "close-work.json").read_text(encoding="utf-8"))
    assert work_item["payload"]["authority_context"]["source_discussion_id"] == discussion_id
    assert work_item["status"] == "ready"


def test_cli_discuss_accepts_structured_decision_payload(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    payload = json.dumps(
        {
            "decision_id": "DEC-host-real-selftest",
            "scope_id": "host-real-board",
            "question": "Which host-real validation workflow should the disposable board follow?",
            "candidate_method_ids": ["feature-run", "bugfix-run", "review-loop"],
            "selected_values": {"workflow": ["feature-run", "bugfix-run", "review-loop"]},
            "status": "frozen",
            "unresolved_gaps": [],
        },
        ensure_ascii=False,
    )
    result = _run_cli(tmp_path, "discuss", "--decision-json", payload)
    assert result.returncode == 0, result.stderr
    decision_path = tmp_path / ".thoth" / "objects" / "decision" / "DEC-host-real-selftest.json"
    assert decision_path.exists()
    stored = json.loads(decision_path.read_text(encoding="utf-8"))
    assert stored["status"] == "accepted"
    payload = json.loads(result.stdout)
    assert payload["command"] == "discuss"
    assert payload["status"] == "ok"


def test_cli_review_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "review", "audit", "this")
    assert result.returncode == 0
    packet = _extract_json_object(result.stdout)
    assert packet["command_id"] == "review"
    assert packet["dispatch_mode"] == "live_native"


def test_cli_sync_regenerates_project_layer(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    agents_path = tmp_path / "AGENTS.md"
    agents_path.write_text("drifted\n", encoding="utf-8")
    result = _run_cli(tmp_path, "init", "--sync")
    assert result.returncode == 0
    assert "drifted" not in agents_path.read_text(encoding="utf-8")


def test_cli_status_json(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "status", "--json")
    assert result.returncode == 0
    payload = _extract_json_object(result.stdout)
    assert payload["active_run_count"] == 0
    assert payload["compiler"]["work_item_counts"]["total"] == 0


def test_cli_doctor_quick(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "doctor", "--quick")
    assert result.returncode == 0
    assert "Thoth Doctor" in result.stdout


def test_cli_doctor_version_prints_only_version_and_update_time(tmp_path):
    result = _run_cli(tmp_path, "doctor", "--version")

    assert result.returncode == 0, result.stderr
    rows = result.stdout.splitlines()
    assert len(rows) == 2
    assert rows[0].startswith("version=")
    assert rows[1].startswith("last_updated=")
    assert result.stderr == ""
    assert "Thoth Doctor" not in result.stdout
    assert "{" not in result.stdout


def test_cli_doctor_fix_preview_does_not_write_project_authority(tmp_path):
    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1").mkdir(parents=True)
    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1" / "legacy.yaml").write_text("id: legacy\n", encoding="utf-8")
    result = _run_cli(tmp_path, "doctor", "--fix", "--preview")
    assert result.returncode == 0, result.stderr
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "ok"
    assert not (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()


def test_cli_init_preview_does_not_apply_project_authority(tmp_path):
    result = _run_cli(tmp_path, "init", "--preview")

    assert result.returncode == 0, result.stderr
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "ok"
    assert payload["body"]["result"]["operation"] == "preview"
    assert (tmp_path / ".thoth" / "migrations" / payload["body"]["result"]["migration_id"] / "preview.json").exists()
    assert not (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()
    assert not (tmp_path / "AGENTS.md").exists()
    assert not (tmp_path / "CLAUDE.md").exists()


def test_cli_init_migrate_accepts_positional_apply_and_removes_legacy_project(tmp_path):
    legacy_contract = tmp_path / ".thoth" / "project" / "contracts" / "contract-1.json"
    legacy_contract.parent.mkdir(parents=True)
    legacy_contract.write_text(
        json.dumps({"contract_id": "contract-1", "goal": "Migrate this legacy contract."}),
        encoding="utf-8",
    )

    result = _run_cli(tmp_path, "init", "--migrate", "apply")

    assert result.returncode == 0, result.stderr
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "ok"
    assert (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()
    assert not (tmp_path / ".thoth" / "project").exists()
    work_item = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "contract-1.json").read_text(encoding="utf-8"))
    assert work_item["status"] == "blocked"


def test_cli_init_migrate_flag_apply_remains_apply(tmp_path):
    result = _run_cli(tmp_path, "init", "--migrate", "--apply")

    assert result.returncode == 0, result.stderr
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "ok"
    assert payload["body"]["result"]["apply"]["status"] == "applied"
    assert (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()


def test_cli_doctor_fix_accepts_positional_preview_without_mutation(tmp_path):
    (tmp_path / ".thoth" / "project" / "tasks").mkdir(parents=True)

    result = _run_cli(tmp_path, "doctor", "--fix", "preview")

    assert result.returncode == 0, result.stderr
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "ok"
    assert payload["body"]["result"]["operation"] == "preview"
    assert ".thoth/project" in payload["body"]["result"]["preview"]["remove"]
    assert not (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()


def test_cli_doctor_fix_without_action_requires_explicit_choice(tmp_path):
    result = _run_cli(tmp_path, "doctor", "--fix")

    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert "thoth init --migrate preview" in payload["body"]["guidance"]


def test_cli_run_rejects_free_form_execution(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", work_goal="Repair session persistence bug in auth flow.")
    _write_task(tmp_path, "task-dashboard", title="Dashboard Polish", work_goal="Polish dashboard filters and layout.")
    result = _run_cli(tmp_path, "run", "legacy free text")
    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert payload["command"] == "run"
    assert payload["body"]["candidates"]
    assert "No work item was created" in payload["summary"]


def test_cli_run_without_work_id_suggests_closest_work_items_and_stops(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", work_goal="Repair session persistence bug in auth flow.")
    _write_task(tmp_path, "task-dashboard", title="Dashboard Polish", work_goal="Polish dashboard filters and layout.")
    _write_task(tmp_path, "task-report", title="Report Cleanup", work_goal="Clean report rendering and summary wording.")
    result = _run_cli(tmp_path, "run", "fix", "auth", "session")
    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert payload["body"]["query"] == "fix auth session"
    candidates = payload["body"]["candidates"]
    assert len(candidates) == 3
    assert candidates[0]["work_id"] == "task-auth-fix"


def test_cli_loop_without_work_id_uses_goal_to_suggest_work_items_and_stops(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "task-column-persist", title="Persist Column Settings", work_goal="Persist dashboard column selections across reloads.")
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", work_goal="Repair session persistence bug in auth flow.")
    result = _run_cli(tmp_path, "loop", "--goal", "persist dashboard column", "--sleep")
    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert payload["body"]["query"] == "persist dashboard column"
    assert payload["body"]["candidates"][0]["work_id"] == "task-column-persist"


def test_cli_runtime_defaults_and_prepare_packet(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "run", "--work-id", "task-1", env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"})
    assert result.returncode == 0, result.stderr
    events = _jsonl_events(result.stdout)
    assert events[0]["type"] == "thoth.run.started"
    assert events[0]["executor"] == "codex"
    assert events[-1]["type"] == "thoth.run.terminal"
    assert events[-1]["status"] == "completed"


def test_cli_auto_runs_ready_work_even_when_blocked_work_exists(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "ready-work", title="Ready Work", work_goal="Complete a ready item.")
    _write_task(
        tmp_path,
        "blocked-work",
        title="Blocked Work",
        work_goal="Wait for human input.",
        status="blocked",
        missing_questions=["Human decision required."],
    )
    assert _run_cli(tmp_path, "init", "--sync").returncode == 0
    doctor = _run_cli(tmp_path, "doctor", "--json")
    assert doctor.returncode == 1

    result = _run_cli(
        tmp_path,
        "auto",
        "--rounds",
        "1",
        "--min-runtime-seconds",
        "0",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete", "THOTH_AUTO_HEARTBEAT_SECONDS": "1"},
    )

    assert result.returncode == 2, result.stderr
    events = _jsonl_events(result.stdout)
    controller_id = next(event.get("controller_id") for event in events if event.get("controller_id"))
    controller_path = tmp_path / ".thoth" / "objects" / "controller" / f"{controller_id}.json"
    controller = json.loads(controller_path.read_text(encoding="utf-8"))
    assert "ready-work" in controller["payload"]["completed_work_ids"]
    assert events[-1]["type"] == "thoth.auto.terminal"
    assert events[-1]["status"] == "paused"


def test_cli_auto_sleep_starts_background_controller(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    assert _run_cli(tmp_path, "init", "--sync").returncode == 0

    result = _run_cli(
        tmp_path,
        "auto",
        "--sleep",
        "--min-runtime-seconds",
        "0",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"},
    )

    assert result.returncode == 0, result.stderr
    payload = _extract_json_object(result.stdout)
    body = payload["body"]
    assert body["background_mode"] == "detached"
    assert body["controller_id"].startswith("controller-auto-")
    assert body["monitor_command"].startswith("thoth auto --watch controller-auto-")


def test_cli_auto_rejects_active_controller_parameter_drift(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    controller = create_auto_controller(
        tmp_path,
        work_ids=[],
        mode="loop",
        host="codex",
        executor="codex",
        scope="all-open",
        rounds=1,
        min_runtime_seconds=60,
    )

    result = _run_cli(tmp_path, "auto", "--rounds", "1", "--min-runtime-seconds", "0")

    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert payload["body"]["active_controller_id"] == controller["object_id"]
    assert payload["body"]["differences"]["min_runtime_seconds"]["existing"] == 60
    assert payload["body"]["differences"]["min_runtime_seconds"]["requested"] == 0


def test_cli_auto_stop_cascades_to_active_child_run(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    strict_task = load_work_for_execution(tmp_path, "task-1", require_ready=True)
    handle, _packet = prepare_execution(
        tmp_path,
        command_id="loop",
        title="Lifecycle Validation",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task=strict_task,
        goal="State stays inspectable under real execution.",
    )
    controller = create_auto_controller(
        tmp_path,
        work_ids=[],
        mode="loop",
        host="codex",
        executor="codex",
        scope="all-open",
        rounds=1,
        min_runtime_seconds=0,
    )
    payload = dict(controller["payload"])
    payload["state"] = "running"
    payload["cursor"] = {**payload["cursor"], "active_run_id": handle.run_id}
    Store(tmp_path).update(
        "controller",
        controller["object_id"],
        expected_revision=controller["revision"],
        updates={"status": "running", "payload": payload},
        history_summary="seed active auto controller",
    )

    result = _run_cli(tmp_path, "auto", "--stop", controller["object_id"])

    assert result.returncode == 0, result.stderr
    envelope = _extract_envelope(result.stdout)
    assert envelope["body"]["stopped_child_run_id"] == handle.run_id
    assert handle.state_json()["status"] == "stopped"


def test_cli_auto_persists_controller_event_log(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    assert _run_cli(tmp_path, "init", "--sync").returncode == 0
    local_state = tmp_path / "local-state"

    result = _run_cli(
        tmp_path,
        "auto",
        "--rounds",
        "1",
        "--min-runtime-seconds",
        "0",
        env={
            "THOTH_TEST_EXTERNAL_WORKER_MODE": "complete",
            "THOTH_AUTO_HEARTBEAT_SECONDS": "1",
            "THOTH_LOCAL_STATE_DIR": str(local_state),
        },
    )

    assert result.returncode == 2, result.stderr
    events = _jsonl_events(result.stdout)
    controller_id = next(event.get("controller_id") for event in events if event.get("controller_id"))
    event_logs = list(local_state.glob(f"*/controllers/{controller_id}/events.jsonl"))
    assert event_logs, "auto controller should persist a local event stream"
    persisted = event_logs[0].read_text(encoding="utf-8")
    assert "thoth.auto.started" in persisted


def test_cli_sleep_mode_auto_backgrounds(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "loop", "--work-id", "task-1", "--sleep")
    assert result.returncode == 0, result.stderr
    packet = _extract_json_object(result.stdout)
    assert packet["dispatch_mode"] == "external_worker"
    assert packet["worker_spawned"] is True


def test_cli_live_mode_rejects_removed_detach_flag(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "run", "--work-id", "task-1", "--detach")
    assert result.returncode == 2
    assert "--detach" in result.stderr
