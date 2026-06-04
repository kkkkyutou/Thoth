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
            "work_id": work_id,
            "title": title,
            "status": status,
            "goal": work_goal,
            "context": f"{module}-{work_id}",
            "constraints": ["temp-project"],
            "acceptance_spec": {
                "kind": "script",
                "description": "Run the lifecycle validation command.",
                "metric": {"name": "lifecycle_checks", "direction": "gte", "threshold": 1},
                "reference_command": eval_command,
            },
            "approach_notes": ["Create runtime packet.", "Observe protocol updates."],
            "run_limits": {"max_iterations": 10, "max_runtime_seconds": 28800},
            "scheduling": {"order": None},
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


def test_cli_init_with_intent_creates_init_discussion_packet(tmp_path):
    raw_intent = "我要做一个 AI 科研项目\n先讨论目标，不要直接生成任务"

    result = _run_cli(tmp_path, "init", raw_intent)

    assert result.returncode == 0, result.stderr
    payload = _extract_envelope(result.stdout)
    init_intent = payload["body"]["init_intent"]
    discussion_id = init_intent["discussion_id"]
    assert init_intent["status"] == "discussion_open"
    assert init_intent["packet"]["packet_kind"] == "discussion_authority"
    assert "work_graph_schema" in init_intent["packet"]
    stored = json.loads((tmp_path / ".thoth" / "objects" / "discussion" / f"{discussion_id}.json").read_text(encoding="utf-8"))
    assert stored["source"].startswith("init:")
    assert stored["payload"]["raw_intent"] == raw_intent
    assert stored["payload"]["messages"][0]["content"] == raw_intent


def test_cli_init_intent_conflicts_with_mutating_modes(tmp_path):
    result = _run_cli(tmp_path, "init", "--sync", "请初始化一个研究项目")

    assert result.returncode == 2
    assert "init intent cannot be combined" in result.stderr
    assert not (tmp_path / ".thoth" / "objects" / "discussion").exists()


def test_cli_init_repeated_intent_appends_open_init_discussion(tmp_path):
    first = _run_cli(tmp_path, "init", "第一段项目意图")
    assert first.returncode == 0, first.stderr
    discussion_id = _extract_envelope(first.stdout)["body"]["init_intent"]["discussion_id"]

    second = _run_cli(tmp_path, "init", "第二段补充意图")

    assert second.returncode == 0, second.stderr
    assert _extract_envelope(second.stdout)["body"]["init_intent"]["discussion_id"] == discussion_id
    stored = json.loads((tmp_path / ".thoth" / "objects" / "discussion" / f"{discussion_id}.json").read_text(encoding="utf-8"))
    assert [row["content"] for row in stored["payload"]["messages"]] == ["第一段项目意图", "第二段补充意图"]
    assert stored["payload"]["raw_intents"] == ["第一段项目意图", "第二段补充意图"]
    assert stored["payload"]["raw_intent"] == "第一段项目意图\n\n第二段补充意图"


def test_cli_init_config_json_with_intent_preserves_config_and_raw_discussion(tmp_path):
    config = {"name": "SmartInit", "description": "configured description", "directions": ["core"]}
    result = _run_cli(tmp_path, "init", "--config-json", json.dumps(config), "自然语言目标")

    assert result.returncode == 0, result.stderr
    project = json.loads((tmp_path / ".thoth" / "objects" / "project" / "project.json").read_text(encoding="utf-8"))
    assert project["payload"]["project"]["name"] == "SmartInit"
    discussion_id = _extract_envelope(result.stdout)["body"]["init_intent"]["discussion_id"]
    discussion = json.loads((tmp_path / ".thoth" / "objects" / "discussion" / f"{discussion_id}.json").read_text(encoding="utf-8"))
    assert discussion["payload"]["raw_intent"] == "自然语言目标"


def test_cli_help_shows_minimal_public_commands(tmp_path):
    result = _run_cli(tmp_path, "--help")
    assert result.returncode == 0
    assert "{init,discuss,run,loop,argue,auto,status,doctor,dashboard,tui,extension}" in result.stdout
    assert "plugin" not in result.stdout
    for hidden in (" sync", " report", " extend", " orchestration"):
        assert hidden not in result.stdout


def test_cli_extension_create_list_validate_writes_receipts(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0

    create = _run_cli(
        tmp_path,
        "extension",
        "create",
        "demo-tool",
        "--title",
        "Demo Tool",
        "--capability",
        "tool,metrics_provider",
    )
    assert create.returncode == 0, create.stderr
    create_payload = _extract_envelope(create.stdout)
    assert create_payload["body"]["extension"]["extension"]["id"] == "demo-tool"
    assert create_payload["body"]["extension"]["receipt"]["path"].startswith(".thoth/local/actions/")

    listed = _run_cli(tmp_path, "extension", "list")
    assert listed.returncode == 0, listed.stderr
    listed_payload = _extract_envelope(listed.stdout)
    assert listed_payload["body"]["extensions"]["plugin_count"] == 1
    assert listed_payload["body"]["extensions"]["plugins"][0]["id"] == "demo-tool"

    validated = _run_cli(tmp_path, "extension", "validate")
    assert validated.returncode == 0, validated.stderr
    validated_payload = _extract_envelope(validated.stdout)
    assert validated_payload["body"]["validation"]["errors"] == []
    assert len(list((tmp_path / ".thoth" / "local" / "actions").glob("act-*.json"))) >= 2


def test_cli_plugin_public_command_is_removed(tmp_path):
    result = _run_cli(tmp_path, "plugin", "list")
    assert result.returncode == 2
    assert "invalid choice" in result.stderr


def test_cli_extension_experiment_register_attach_select_projects_metrics(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    (tmp_path / "metrics.jsonl").write_text(
        json.dumps({"step": 1, "metrics": {"loss": 2.0}}) + "\n"
        + json.dumps({"step": 2, "metrics": {"loss": 1.0}}) + "\n",
        encoding="utf-8",
    )

    registered = _run_cli(
        tmp_path,
        "extension",
        "experiment",
        "register",
        "exp-demo",
        "--title",
        "Demo Experiment",
        "--status",
        "running",
        "--actor",
        "unit-agent",
        "--work-id",
        "optional-work",
    )
    assert registered.returncode == 0, registered.stderr
    assert (tmp_path / ".thoth" / "objects" / "experiment" / "exp-demo.json").exists()

    duplicate = _run_cli(tmp_path, "extension", "experiment", "register", "exp-demo", "--actor", "unit-agent")
    assert duplicate.returncode == 2

    attached = _run_cli(
        tmp_path,
        "extension",
        "experiment",
        "attach-source",
        "exp-demo",
        "--id",
        "train-jsonl",
        "--channel",
        "metrics",
        "--type",
        "jsonl",
        "--path",
        "metrics.jsonl",
        "--series",
        "train",
        "--actor",
        "unit-agent",
    )
    assert attached.returncode == 0, attached.stderr

    selected = _run_cli(tmp_path, "extension", "experiment", "select", "exp-demo")
    assert selected.returncode == 0, selected.stderr

    snapshot = _run_cli(tmp_path, "tui", "--snapshot-json", "--no-gpu", "--no-python-plugins")
    payload = json.loads(snapshot.stdout)
    assert payload["tui"]["surface_version"] == 3
    assert payload["metrics"]["experiment_id"] == "exp-demo"
    assert payload["metrics"]["record_count"] == 2


def test_cli_tui_snapshot_json_is_launch_safe(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0

    result = _run_cli(
        tmp_path,
        "tui",
        "--snapshot-json",
        "--no-gpu",
        "--no-python-plugins",
        "--local-window-steps",
        "1000",
        "--global-max-points",
        "80",
        "--decimal-places",
        "3",
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["tui"]["surface_version"] == 3
    assert payload["project_root"] == str(tmp_path)
    assert payload["gpu"]["reason"] == "disabled"
    assert payload["metrics"]["configured"] is False
    assert payload["tui"]["no_python_plugins"] is True
    assert payload["tui"]["global_max_points"] == 80
    assert payload["tui"]["decimal_places"] == 3


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
        "approach_notes",
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
        json.dumps({"work_id": "blocked-work", "title": "Blocked Work", "goal": "Blocked work.", "status": "ready"}),
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["body"]["work_item"]["status"] == "blocked"
    assert "ready work_item requires acceptance_spec" in payload["body"]["work_item_ready_errors"]
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
                    "goal": "Close this work.",
                    "context": "test",
                    "constraints": ["temp-project"],
                    "acceptance_spec": {
                        "kind": "script",
                        "description": "Run pytest.",
                        "metric": {"name": "checks", "direction": "gte", "threshold": 1},
                        "reference_command": "pytest -q",
                    },
                    "approach_notes": ["Run validator."],
                    "run_limits": {"max_iterations": 1, "max_runtime_seconds": 60},
                    "scheduling": {"order": None},
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
    assert {"type": "primary_parent", "target": f"discussion:{discussion_id}"} in work_item["links"]
    assert work_item["status"] == "ready"


def test_cli_record_discussion_authority_accepts_compact_work_graph(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "close", "a", "dag")
    discussion_id = json.loads(result.stdout)["body"]["discussion"]["discussion_id"]
    capsule_path = tmp_path / "authority-graph.json"
    capsule_path.write_text(
        json.dumps(
            {
                "goal": {"source_summary": "Build a DAG.", "normalized_summary": "Build a DAG."},
                "constraints": ["temp-project"],
                "open_questions": [],
                "completeness": {"is_closed": True},
                "work_graph": {
                    "nodes": {
                        "WG-A": {
                            "title": "Upstream",
                            "goal": "Finish upstream.",
                            "acceptance_spec": {
                                "kind": "script",
                                "description": "Run upstream pytest.",
                                "metric": {"name": "checks", "direction": "gte", "threshold": 1},
                            },
                            "missing_questions": [],
                        },
                        "WG-B": {
                            "title": "Downstream",
                            "goal": "Finish downstream.",
                            "acceptance_spec": {
                                "kind": "script",
                                "description": "Run downstream pytest.",
                                "metric": {"name": "checks", "direction": "gte", "threshold": 1},
                            },
                            "missing_questions": [],
                        },
                    },
                    "edges": [{"from": "WG-A", "to": "WG-B"}],
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
    upstream = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "WG-A.json").read_text(encoding="utf-8"))
    downstream = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "WG-B.json").read_text(encoding="utf-8"))
    assert upstream["status"] == "ready"
    assert downstream["status"] == "ready"
    assert {"type": "depends_on", "target": "work_item:WG-A"} in downstream["links"]


def test_cli_record_discussion_authority_rejects_invalid_work_graph_without_writes(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "close", "bad", "dag")
    discussion_id = json.loads(result.stdout)["body"]["discussion"]["discussion_id"]
    before = json.loads((tmp_path / ".thoth" / "objects" / "discussion" / f"{discussion_id}.json").read_text(encoding="utf-8"))
    capsule_path = tmp_path / "authority-bad-graph.json"
    capsule_path.write_text(
        json.dumps(
            {
                "goal": {"source_summary": "Build a DAG.", "normalized_summary": "Build a DAG."},
                "open_questions": [],
                "completeness": {"is_closed": True},
                "work_graph": {
                    "nodes": {
                        "WG-A": {"goal": "A"},
                        "WG-B": {"goal": "B"},
                    },
                    "edges": [{"from": "WG-A", "to": "WG-B"}, {"from": "WG-B", "to": "WG-A"}],
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
    after = json.loads((tmp_path / ".thoth" / "objects" / "discussion" / f"{discussion_id}.json").read_text(encoding="utf-8"))
    assert after["revision"] == before["revision"]
    assert not (tmp_path / ".thoth" / "objects" / "work_item" / "WG-A.json").exists()
    assert "dependency cycle" in close.stdout


def test_init_discussion_close_can_patch_project_and_write_work_graph(tmp_path):
    init_result = _run_cli(tmp_path, "init", "初始化一个智能研究项目")
    assert init_result.returncode == 0, init_result.stderr
    discussion_id = _extract_envelope(init_result.stdout)["body"]["init_intent"]["discussion_id"]
    capsule_path = tmp_path / "init-close.json"
    capsule_path.write_text(
        json.dumps(
            {
                "goal": {"source_summary": "Initialize Smart Project.", "normalized_summary": "Initialize Smart Project."},
                "open_questions": [],
                "completeness": {"is_closed": True},
                "project_patch": {
                    "name": "Smart Project",
                    "description": "A compact project identity confirmed through init discussion.",
                    "directions": [{"id": "core", "label_en": "Core"}],
                },
                "work_graph": {
                    "nodes": {
                        "INIT-W1": {
                            "title": "First Work",
                            "goal": "Do first work.",
                            "acceptance_spec": {
                                "kind": "script",
                                "description": "Run first check.",
                                "metric": {"name": "checks", "direction": "gte", "threshold": 1},
                            },
                            "missing_questions": [],
                        }
                    },
                    "edges": [],
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
    project = json.loads((tmp_path / ".thoth" / "objects" / "project" / "project.json").read_text(encoding="utf-8"))
    docs_project = json.loads((tmp_path / ".thoth" / "docs" / "project.json").read_text(encoding="utf-8"))
    assert project["payload"]["project"]["name"] == "Smart Project"
    assert docs_project["project"]["name"] == "Smart Project"
    assert (tmp_path / ".thoth" / "objects" / "work_item" / "INIT-W1.json").exists()


def test_normal_discussion_rejects_project_patch_without_writes(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "normal", "discussion")
    discussion_id = json.loads(result.stdout)["body"]["discussion"]["discussion_id"]
    capsule_path = tmp_path / "bad-project-patch.json"
    capsule_path.write_text(
        json.dumps(
            {
                "goal": {"source_summary": "Patch project.", "normalized_summary": "Patch project."},
                "open_questions": [],
                "completeness": {"is_closed": True},
                "project_patch": {"name": "Should Not Apply"},
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
    project = json.loads((tmp_path / ".thoth" / "objects" / "project" / "project.json").read_text(encoding="utf-8"))
    assert project["payload"]["project"]["name"] != "Should Not Apply"
    assert "project_patch is only allowed" in close.stdout


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
                    "goal": "Close this work.",
                    "context": "test",
                    "constraints": ["temp-project"],
                    "approach_notes": ["Run validator."],
                    "run_limits": {"max_iterations": 1, "max_runtime_seconds": 60},
                    "scheduling": {"order": None},
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
    assert "acceptance_spec" in diagnostics["missing_work_json_fields"]
    assert "ready work_item requires acceptance_spec" in diagnostics["work_item_ready_errors"]
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


def test_cli_argue_records_adversarial_artifacts(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "argue", "audit", "this", env={"THOTH_TEST_ARGUE_WORKER_MODE": "complete"})
    assert result.returncode == 0, result.stderr
    envelope = _extract_envelope(result.stdout)
    body = envelope["body"]
    assert body["decision_impact"] == "revise_authority"
    assert body["target"]["target_kind"] == "idea"
    assert Path(body["artifacts"]["argument"]).exists()
    assert Path(body["artifacts"]["attack"]).exists()
    assert Path(body["artifacts"]["adjudication"]).exists()
    run = json.loads((tmp_path / ".thoth" / "runs" / body["run_id"] / "run.json").read_text(encoding="utf-8"))
    assert run["kind"] == "argue"


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


def test_cli_run_reconcile_flag_is_removed(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0

    result = _run_cli(tmp_path, "run", "--reconcile", "run-old")

    assert result.returncode == 2
    assert "--reconcile" in result.stderr


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


def test_cli_executor_defaults_to_host(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "task-claude", title="Claude Host Task", work_goal="Use the host-aligned executor.")

    result = _run_cli(
        tmp_path,
        "run",
        "--host",
        "claude",
        "--work-id",
        "task-claude",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"},
    )

    assert result.returncode == 0, result.stderr
    events = _jsonl_events(result.stdout)
    assert events[0]["executor"] == "claude"


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
    assert controller["payload"]["attempts"][0]["work_id"] == "ready-work"
    assert controller["payload"]["attempts"][0]["status"] == "completed"
    assert "completed_work_ids" not in controller["payload"]
    assert "queue" not in controller["payload"]
    assert events[-1]["type"] == "thoth.auto.terminal"
    assert events[-1]["status"] == "paused"


def test_cli_auto_refreshes_stale_object_graph_summary_before_preflight(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    assert _run_cli(tmp_path, "init", "--sync").returncode == 0
    _write_task(tmp_path, "late-ready", title="Late Ready", work_goal="Refresh stale summary and run.")

    doctor = _run_cli(tmp_path, "doctor", "--json")
    doctor_payload = _extract_envelope(doctor.stdout)
    stale_check = next(check for check in doctor_payload["checks"] if check["id"] == "object-graph-summary-current")
    assert stale_check["ok"] is False
    assert "stale_fields" in stale_check["detail"]

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
    assert "Auto preflight failed" not in result.stdout
    events = _jsonl_events(result.stdout)
    controller_id = next(event.get("controller_id") for event in events if event.get("controller_id"))
    controller = json.loads((tmp_path / ".thoth" / "objects" / "controller" / f"{controller_id}.json").read_text(encoding="utf-8"))
    assert controller["payload"]["attempts"][0]["work_id"] == "late-ready"
    assert controller["payload"]["attempts"][0]["status"] == "completed"
    assert "completed_work_ids" not in controller["payload"]


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
    assert payload["attempts"][0]["work_id"] == "task-1"
    assert payload["attempts"][0]["run_id"].startswith("loop-")
    assert payload["attempts"][0]["status"] == "failed"
    assert "attempted_work_ids" not in payload
    assert "failed_work_ids" not in payload
    assert "queue" not in payload
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
    assert "attempted_work_ids" not in payload
    assert "failed_work_ids" not in payload
    assert "queue" not in payload


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
