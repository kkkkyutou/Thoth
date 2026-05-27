"""Tests for the Claude command bridge."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from thoth.plan.store import upsert_work_item, upsert_decision
from thoth.surface.bridges.claude import _expand_bridge_args


ROOT = Path(__file__).parent.parent.parent


def _bridge_entry() -> Path:
    candidates = [
        ROOT / "thoth" / "surface" / "bridges" / "claude.py",
        ROOT / "thoth" / "claude_bridge.py",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise AssertionError(f"No Claude bridge entry found under {ROOT}")


def _run_bridge(tmp_path: Path, command_id: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    env["THOTH_CLAUDE_PLUGIN_ROOT"] = str(ROOT)
    env["THOTH_TEST_ARGUE_WORKER_MODE"] = "complete"
    env["THOTH_TEST_EXTERNAL_WORKER_MODE"] = "complete"
    return subprocess.run(
        [sys.executable, str(_bridge_entry()), command_id, *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=env,
    )


def _write_task(
    project_dir: Path,
    work_id: str,
    *,
    title: str,
    work_goal: str,
    review_binding: dict[str, object] | None = None,
    review_expectation: dict[str, object] | None = None,
) -> None:
    decision_id = f"DEC-{work_id}"
    upsert_decision(
        project_dir,
        {
            "schema_version": 1,
            "kind": "decision",
            "decision_id": decision_id,
            "scope_id": f"scope-{work_id}",
            "question": "Which strict task should be executed?",
            "candidate_method_ids": ["repo-change"],
            "selected_values": {"candidate_method_id": "repo-change"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    io_examples: dict[str, object] = {}
    if review_binding is not None:
        io_examples["review_binding"] = review_binding
    if review_expectation is not None:
        io_examples["review_expectation"] = review_expectation
    contract_payload = {
        "work_id": work_id,
        "title": title,
        "status": "ready",
        "goal": work_goal,
        "context": f"scope-{work_id}",
        "constraints": ["repo"],
        "acceptance_spec": {
            "kind": "script",
            "description": "Run the focused validation command.",
            "metric": {"name": "checks", "direction": "gte", "threshold": 1},
            "reference_command": "pytest -q",
            **({"io_examples": io_examples} if io_examples else {}),
        },
        "approach_notes": ["Make the requested repo change."],
        "run_limits": {"max_iterations": 10, "max_runtime_seconds": 28800},
        "scheduling": {"order": None},
        "decisions": [decision_id],
        "missing_questions": [],
    }
    upsert_work_item(project_dir, contract_payload)


def test_bridge_executes_repo_local_init_and_records_event(tmp_path):
    result = _run_bridge(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "init"
    assert payload["bridge_success"] is True
    assert payload["checks"]["project_manifest_exists"] is True
    event_log = tmp_path / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl"
    assert event_log.exists()
    event = json.loads(event_log.read_text(encoding="utf-8").splitlines()[-1])
    assert event["command_id"] == "init"
    assert event["bridge_success"] is True


def test_bridge_records_status_after_init(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    status_result = _run_bridge(tmp_path, "status")
    assert status_result.returncode == 0, status_result.stderr
    status_payload = json.loads(status_result.stdout)
    assert status_payload["command_id"] == "status"
    assert status_payload["bridge_success"] is True
    events = [
        json.loads(line)
        for line in (tmp_path / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert [event["command_id"] for event in events][-2:] == ["init", "status"]


def test_bridge_discuss_reads_multiline_arguments_file(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    args_file = tmp_path / "discuss-args.txt"
    args_file.write_text(
        "这个项目叫demo_project\n"
        "/tmp/thoth-demo-project/eva01/materials/sample-sigconf.tex\n"
        "/tmp/thoth-demo-project/eva01/context-snapshot.md\n",
        encoding="utf-8",
    )

    result = _run_bridge(tmp_path, "discuss", "--thoth-arguments-file", str(args_file))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bridge_success"] is True
    assert payload["arguments"] == [args_file.read_text(encoding="utf-8").rstrip("\n")]
    assert "/tmp/thoth-demo-project/eva01/context-snapshot.md" in payload["argv"][-1]


def test_bridge_init_reads_multiline_arguments_file_as_raw_intent(tmp_path):
    args_file = tmp_path / "init-args.txt"
    args_file.write_text(
        "我要初始化一个 AI 科研项目\n"
        "先问清楚目标、验收和 DAG，不要直接生成 ready work\n",
        encoding="utf-8",
    )

    result = _run_bridge(tmp_path, "init", "--thoth-arguments-file", str(args_file))

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bridge_success"] is True
    assert payload["arguments"] == ["--intent", args_file.read_text(encoding="utf-8").rstrip("\n")]
    discussions = sorted((tmp_path / ".thoth" / "objects" / "discussion").glob("DISC-*.json"))
    assert len(discussions) == 1
    discussion = json.loads(discussions[0].read_text(encoding="utf-8"))
    assert discussion["source"].startswith("init:")
    assert discussion["payload"]["raw_intent"] == args_file.read_text(encoding="utf-8").rstrip("\n")


def test_bridge_run_arguments_file_uses_shlex_flags(tmp_path):
    args_file = tmp_path / "run-args.txt"
    args_file.write_text("--work-id task-auth-fix --sleep", encoding="utf-8")

    assert _expand_bridge_args("run", ["--host", "claude", "--thoth-arguments-file", str(args_file)]) == [
        "--host",
        "claude",
        "--work-id",
        "task-auth-fix",
        "--sleep",
    ]


def test_bridge_uses_plugin_cli_even_if_project_has_shadow_thoth_package(tmp_path):
    shadow_pkg = tmp_path / "thoth"
    shadow_pkg.mkdir()
    (shadow_pkg / "__init__.py").write_text("", encoding="utf-8")
    (shadow_pkg / "cli.py").write_text(
        "raise SystemExit('shadow-cli-should-not-run')\n",
        encoding="utf-8",
    )

    result = _run_bridge(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bridge_success"] is True
    assert "shadow-cli-should-not-run" not in payload["stderr"]


def test_bridge_argue_runs_adversarial_discussion(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True

    result = _run_bridge(tmp_path, "argue", "--executor", "codex", "backend/app.py")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "argue"
    assert payload["bridged_command_id"] == "argue"
    assert payload["bridge_success"] is True
    stdout = json.loads(payload["stdout"])
    assert stdout["body"]["target"]["target_kind"] == "idea"
    assert stdout["body"]["decision_impact"] == "revise_authority"
    assert payload["checks"]["run_ledger_exists"] is True


def test_bridge_argue_binds_ready_work_item(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    _write_task(
        tmp_path,
        "task-review-probe",
        title="Return fixed review finding",
        work_goal="Inspect tracker/review_probe.py and emit one exact structured finding.",
        review_binding={"target": "tracker/review_probe.py"},
        review_expectation={
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
    )

    result = _run_bridge(tmp_path, "argue", "--work-id", "task-review-probe", "tracker/review_probe.py")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bridge_success"] is True
    stdout = json.loads(payload["stdout"])
    assert stdout["body"]["target"]["target_kind"] == "work_item"
    assert stdout["body"]["target"]["target_id"] == "task-review-probe"
    work_item = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "task-review-probe.json").read_text(encoding="utf-8"))
    assert work_item["status"] == "ready"


def test_bridge_run_without_work_id_returns_candidate_work_items_and_stops(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", work_goal="Repair session persistence bug in auth flow.")
    _write_task(tmp_path, "task-dashboard", title="Dashboard Polish", work_goal="Polish dashboard filters and layout.")

    result = _run_bridge(tmp_path, "run", "fix", "auth", "session")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "run"
    assert payload["bridge_success"] is False
    assert "task-auth-fix" in payload["stdout"]
    assert "No work item was created" in payload["stdout"]


def test_bridge_run_defaults_executor_to_claude_host(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    _write_task(tmp_path, "task-runtime-probe", title="Runtime Probe", work_goal="Check host-aligned executor.")

    result = _run_bridge(tmp_path, "run", "--host", "claude", "--work-id", "task-runtime-probe")

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bridge_success"] is True
    events = [json.loads(line) for line in payload["stdout"].splitlines() if line.strip()]
    assert events[0]["executor"] == "claude"


def test_bridge_auto_returns_monitor_packet_without_blocking_on_watch(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True

    result = _run_bridge(tmp_path, "auto", "--min-runtime-seconds", "0")

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "auto"
    assert payload["bridge_success"] is True
    assert "--monitor-packet" in payload["argv"]
    stdout = json.loads(payload["stdout"])
    body = stdout["body"]
    assert body["controller_id"].startswith("controller-auto-")
    assert body["monitor_command"].startswith("thoth auto --watch controller-auto-")
