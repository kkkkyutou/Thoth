"""Tests for the official `$thoth` CLI surface."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from thoth.objects import Store
from thoth.plan.store import load_work_for_execution, load_work_result, upsert_work_item, upsert_decision
from thoth.run.controllers import create_auto_controller
from thoth.run.packets import prepare_execution
from thoth.run.ledger import fail_run
from thoth.run.phases import default_validate_output_schema, submit_phase_output


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


def _git(tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    )


def _copy_path(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


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
    assert "/runs/" in (tmp_path / ".thoth" / ".gitignore").read_text(encoding="utf-8")
    assert "node_modules/" in (tmp_path / "tools" / "dashboard" / "frontend" / ".gitignore").read_text(encoding="utf-8")


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
    assert packet["required_authority_categories"] == [
        "goal",
        "constraints",
        "decisions",
        "risks",
        "run_instructions",
        "open_questions",
    ]
    assert "non_goals" not in packet["required_authority_categories"]
    assert "work_json_template" in packet
    assert packet["required_work_json_fields"]
    assert packet["open_discussion_candidates"][0]["discussion_id"] == envelope["body"]["discussion"]["discussion_id"]


def test_cli_discuss_continuation_appends_open_discussion(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    first = _run_cli(tmp_path, "discuss", "plan", "dashboard", "work")
    assert first.returncode == 0
    first_payload = json.loads(first.stdout)
    discussion_id = first_payload["body"]["discussion"]["discussion_id"]

    second = _run_cli(tmp_path, "discuss", "继续", discussion_id, "add", "constraint")

    assert second.returncode == 0, second.stderr
    second_payload = json.loads(second.stdout)
    assert second_payload["body"]["discussion_mode"] == "appended"
    discussions = list((tmp_path / ".thoth" / "objects" / "discussion").glob("*.json"))
    assert len(discussions) == 1
    stored = json.loads(discussions[0].read_text(encoding="utf-8"))
    assert stored["object_id"] == discussion_id
    assert [row["content"] for row in stored["payload"]["messages"]] == [
        "plan dashboard work",
        f"继续 {discussion_id} add constraint",
    ]


def test_cli_discuss_work_json_missing_fields_creates_blocked_with_diagnostics(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(
        tmp_path,
        "discuss",
        "--work-json",
        json.dumps({"work_id": "blocked-work", "title": "Blocked Work", "work_kind": "execution", "runnable": True}),
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["body"]["work_item"]["status"] == "blocked"
    assert "eval_contract.entrypoint.command is required" in payload["body"]["work_item_ready_errors"]
    assert "required_work_json_fields" in payload["body"]
    stored = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "blocked-work.json").read_text(encoding="utf-8"))
    assert stored["status"] == "blocked"


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


def test_cli_record_discussion_authority_needs_input_lists_missing_fields(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "close", "with", "missing", "validator")
    discussion_id = json.loads(result.stdout)["body"]["discussion"]["discussion_id"]
    capsule_path = tmp_path / "authority-missing.json"
    capsule_path.write_text(
        json.dumps(
            {
                "goal": {"source_summary": "关闭这个工作。", "normalized_summary": "Close this work."},
                "constraints": ["temp-project"],
                "accepted_decisions": [
                    {
                        "decision_id": "DEC-close-missing",
                        "question": "Close which work?",
                        "selected_values": {"work": "close-work"},
                        "status": "frozen",
                        "unresolved_gaps": [],
                    }
                ],
                "open_questions": [],
                "completeness": {"is_closed": True},
                "work_item": {
                    "work_id": "close-missing",
                    "title": "Close Missing",
                    "status": "ready",
                    "work_kind": "execution",
                    "runnable": True,
                    "goal": "Close this work.",
                    "context": "test",
                    "constraints": ["temp-project"],
                    "execution_plan": ["Run validator."],
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

    assert close.returncode == 2
    payload = json.loads(close.stdout)
    diagnostics = payload["body"]["diagnostics"]
    assert "eval_contract" in diagnostics["missing_work_json_fields"]
    assert "eval_contract.entrypoint.command is required" in diagnostics["work_item_ready_errors"]
    assert "next_minimal_json" in diagnostics
    assert not (tmp_path / ".thoth" / "objects" / "work_item" / "close-missing.json").exists()


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


def test_cli_sync_appends_ignore_rules_without_duplicates(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    (tmp_path / ".gitignore").write_text("custom.out\n", encoding="utf-8")

    first = _run_cli(tmp_path, "init", "--sync")
    second = _run_cli(tmp_path, "init", "--sync")

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    root_ignore = (tmp_path / ".gitignore").read_text(encoding="utf-8")
    thoth_ignore = (tmp_path / ".thoth" / ".gitignore").read_text(encoding="utf-8")
    assert "custom.out" in root_ignore
    assert root_ignore.splitlines().count("/research.db") == 1
    assert thoth_ignore.splitlines().count("/runs/") == 1
    assert thoth_ignore.splitlines().count("/docs/work-results/") == 1


def test_cli_status_recovers_from_portable_authority_without_runtime_dirs(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "portable-work")

    clone = tmp_path / "fresh-clone"
    clone.mkdir()
    for rel in (
        "AGENTS.md",
        "CLAUDE.md",
        ".gitignore",
        ".thoth/.gitignore",
        ".thoth/objects/project",
        ".thoth/objects/work_item",
        ".thoth/objects/discussion",
        ".thoth/objects/decision",
        ".thoth/docs/agent-entry.md",
        ".thoth/docs/project.json",
        ".thoth/docs/source-map.json",
    ):
        src = tmp_path / rel
        if src.exists():
            _copy_path(src, clone / rel)

    result = _run_cli(clone, "status", "--json", env={"THOTH_LOCAL_STATE_DIR": str(clone / ".machine-state")})

    assert result.returncode == 0, result.stderr
    payload = _extract_json_object(result.stdout)
    assert payload["compiler"]["work_item_counts"]["ready"] == 1
    assert payload["active_run_count"] == 0
    assert not (clone / ".thoth" / "runs").exists()
    assert not (clone / ".thoth" / "derived").exists()


def test_cli_run_runtime_ledgers_do_not_dirty_git_status(tmp_path):
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "test@test.com")
    _git(tmp_path, "config", "user.name", "Test")
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "git-clean-work")
    assert _run_cli(tmp_path, "init", "--sync").returncode == 0
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-m", "init thoth authority")

    result = _run_cli(
        tmp_path,
        "run",
        "--work-id",
        "git-clean-work",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"},
    )
    assert result.returncode == 0, result.stderr
    assert list((tmp_path / ".thoth" / "runs").glob("run-*"))
    assert list((tmp_path / ".thoth" / "objects" / "run").glob("run-*.json"))
    assert list((tmp_path / ".thoth" / "objects" / "artifact").glob("*.json"))
    assert list((tmp_path / ".thoth" / "objects" / "phase_result").glob("*.json"))

    (tmp_path / "tools" / "dashboard" / "frontend" / "node_modules" / "pkg").mkdir(parents=True)
    (tmp_path / "tools" / "dashboard" / "frontend" / "node_modules" / "pkg" / "index.js").write_text("", encoding="utf-8")
    (tmp_path / "tools" / "dashboard" / "frontend" / "dist").mkdir(exist_ok=True)
    (tmp_path / "tools" / "dashboard" / "frontend" / "dist" / "index.html").write_text("<div id=\"app\"></div>", encoding="utf-8")
    (tmp_path / "research.db").write_text("", encoding="utf-8")
    (tmp_path / ".thoth" / "derived" / "dashboard.pid").write_text("123\n", encoding="utf-8")

    status = _git(tmp_path, "status", "--short", "--untracked-files=all").stdout

    assert ".thoth/runs/" not in status
    assert ".thoth/objects/run/" not in status
    assert ".thoth/objects/artifact/" not in status
    assert ".thoth/objects/phase_result/" not in status
    assert ".thoth/docs/work-results/" not in status
    assert ".thoth/derived/" not in status
    assert "node_modules/" not in status
    assert "tools/dashboard/frontend/dist/" not in status
    assert "research.db" not in status


def test_cli_run_reconcile_closes_failed_run_with_passing_execute_receipt(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "reconcile-work", eval_command="pytest -q")
    strict_task = load_work_for_execution(tmp_path, "reconcile-work")
    handle, _packet = prepare_execution(
        tmp_path,
        command_id="run",
        title="Reconcile Work",
        work_id="reconcile-work",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task=strict_task,
        goal="reconcile old run",
    )
    submit_phase_output(
        tmp_path,
        handle.run_id,
        phase="plan",
        payload={
            "summary": "plan ok",
            "authority_complete": True,
            "open_gaps": [],
            "plan": "# Plan\n\nRun the official pytest validator against the final implementation.",
        },
    )
    submit_phase_output(
        tmp_path,
        handle.run_id,
        phase="execute",
        payload={
            "summary": "execute passed official pytest",
            "report": "# Execute Report\n\nRan the official pytest validator against the final implementation.",
            "official_validation_receipt": {
                "command": "pytest -q",
                "cwd": str(tmp_path),
                "python_executable": sys.executable,
                "exit_code": 0,
                "passed": True,
                "metric_value": 1,
                "checks_summary": ["3 passed"],
                "stdout_log": "3 passed\n",
                "stderr_log": "[empty stderr captured]",
            },
        },
    )
    fail_run(tmp_path, handle.run_id, summary="Historical runtime contract failure.", reason="execution_error")

    result = _run_cli(tmp_path, "run", "--reconcile", handle.run_id)

    assert result.returncode == 0, result.stderr
    envelope = _extract_envelope(result.stdout)
    assert envelope["status"] == "ok"
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["status"] == "completed"
    assert run_result["result"]["reconciled"] is True
    assert run_result["result"]["validate_passed"] is True
    assert (handle.run_dir / "reconcile.json").exists()
    work_item = Store(tmp_path).read("work_item", "reconcile-work")
    assert work_item["status"] == "validated"


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


def test_cli_run_records_trailing_guidance(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(
        tmp_path,
        "run",
        "--work-id",
        "task-1",
        "focus on repo-local dependency repair",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"},
    )

    assert result.returncode == 0, result.stderr
    run_dirs = sorted((tmp_path / ".thoth" / "runs").glob("run-*"))
    assert run_dirs
    guidance_rows = [
        json.loads(line)
        for line in (run_dirs[-1] / "guidance.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert guidance_rows[0]["source"] == "initial_invocation"
    assert guidance_rows[0]["message"] == "focus on repo-local dependency repair"
    phase_state = json.loads((run_dirs[-1] / "phase_state.json").read_text(encoding="utf-8"))
    assert phase_state["guidance"]["initial"]["message"] == "focus on repo-local dependency repair"


def test_cli_append_guidance_writes_run_inbox(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    handle, _packet = prepare_execution(
        tmp_path,
        command_id="run",
        title="Guidance target",
        work_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task=load_work_for_execution(tmp_path, "task-1", require_ready=True),
        goal="Guidance target",
    )

    result = _run_cli(
        tmp_path,
        "append-guidance",
        "--project-root",
        str(tmp_path),
        "--run-id",
        handle.run_id,
        "--message",
        "现在改，不要继续当前实现",
        "--interrupt",
    )

    assert result.returncode == 0, result.stderr
    rows = [
        json.loads(line)
        for line in (handle.run_dir / "guidance.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert rows[-1]["interrupt_requested"] is True
    assert rows[-1]["message"] == "现在改，不要继续当前实现"


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


def test_cli_auto_failed_child_updates_only_attempted_work_item(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    for index in range(1, 4):
        _write_task(tmp_path, f"task-{index}", title=f"Task {index}", work_goal=f"Fail task {index}.")
    assert _run_cli(tmp_path, "init", "--sync").returncode == 0

    result = _run_cli(
        tmp_path,
        "auto",
        "--rounds",
        "1",
        "--min-runtime-seconds",
        "0",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "fail", "THOTH_AUTO_HEARTBEAT_SECONDS": "1"},
    )

    assert result.returncode == 2, result.stderr
    events = _jsonl_events(result.stdout)
    controller_id = next(event.get("controller_id") for event in events if event.get("controller_id"))
    controller = json.loads((tmp_path / ".thoth" / "objects" / "controller" / f"{controller_id}.json").read_text(encoding="utf-8"))
    payload = controller["payload"]
    assert payload["attempted_work_ids"] == ["task-1"]
    assert payload["failed_work_ids"] == ["task-1"]
    assert payload["attempts"][0]["work_id"] == "task-1"
    assert payload["attempts"][0]["run_id"].startswith("loop-")
    assert payload["attempts"][0]["status"] == "failed"
    assert [item["work_id"] for item in payload["queue"]] == ["task-2", "task-3"]
    assert load_work_result(tmp_path, "task-1")["status"] == "attempt_failed"
    assert load_work_result(tmp_path, "task-2") == {}
    assert load_work_result(tmp_path, "task-3") == {}
    for index in range(1, 4):
        assert Store(tmp_path).read("work_item", f"task-{index}")["status"] == "ready"


def test_cli_auto_failed_children_are_backed_by_child_attempts(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    for index in range(1, 3):
        _write_task(tmp_path, f"task-{index}", title=f"Task {index}", work_goal=f"Fail task {index}.")
    assert _run_cli(tmp_path, "init", "--sync").returncode == 0

    result = _run_cli(
        tmp_path,
        "auto",
        "--rounds",
        "2",
        "--min-runtime-seconds",
        "0",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "fail", "THOTH_AUTO_HEARTBEAT_SECONDS": "1"},
    )

    assert result.returncode == 2, result.stderr
    events = _jsonl_events(result.stdout)
    controller_id = next(event.get("controller_id") for event in events if event.get("controller_id"))
    controller = json.loads((tmp_path / ".thoth" / "objects" / "controller" / f"{controller_id}.json").read_text(encoding="utf-8"))
    payload = controller["payload"]
    attempts = payload["attempts"]
    assert [attempt["work_id"] for attempt in attempts] == ["task-1", "task-2"]
    assert [attempt["status"] for attempt in attempts] == ["failed", "failed"]
    assert len({attempt["run_id"] for attempt in attempts}) == 2
    assert payload["attempted_work_ids"] == ["task-1", "task-2"]
    assert payload["failed_work_ids"] == ["task-1", "task-2"]
    assert payload["queue"] == []


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
    result = _run_cli(
        tmp_path,
        "loop",
        "--work-id",
        "task-1",
        "--sleep",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"},
    )
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
