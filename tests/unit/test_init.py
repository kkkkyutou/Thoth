"""Tests for strict init workflow helpers."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
import yaml

from thoth.init.audit import audit_repository_state
from thoth.init.apply import build_init_preview
from thoth.init.render import (
    DEFAULT_PHASES,
    REQUIRED_AGENT_OS_FILES,
    generate_agent_os_docs,
    generate_codex_hook_projection,
    generate_dashboard,
    generate_host_projections,
    generate_milestones,
    generate_pre_commit_config,
    generate_scripts,
    generate_tests,
    generate_thoth_runtime,
    parse_config,
)
from thoth.init.service import initialize_project, preview_project_migration, sync_project_layer
from thoth.objects import Store
from thoth.run.phases import default_validate_output_schema


@pytest.fixture
def base_config():
    return {
        "name": "UnitTestProject",
        "description": "Test project for init.py",
        "language": "en",
        "directions": ["frontend", "backend"],
        "phases": DEFAULT_PHASES,
        "port": 8501,
        "theme": "warm-bear",
    }


def test_parse_config_from_json():
    config_json = json.dumps({"name": "ParseTest", "directions": "alpha,beta,gamma", "language": "zh"})
    config = parse_config(config_json)
    assert config["name"] == "ParseTest"
    assert config["directions"] == ["alpha", "beta", "gamma"]
    assert config["language"] == "zh"
    assert config["port"] == 8501


def test_generate_agent_os_docs(base_config, tmp_path):
    generate_agent_os_docs(base_config, tmp_path)
    for fname in REQUIRED_AGENT_OS_FILES:
        path = tmp_path / ".agent-os" / fname
        assert path.exists()
        assert path.read_text(encoding="utf-8").startswith("#")


def test_generate_host_projections(base_config, tmp_path):
    generate_host_projections(base_config, tmp_path)
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / "CLAUDE.md").exists()
    assert (tmp_path / "AGENTS.md").read_text(encoding="utf-8") == (tmp_path / "CLAUDE.md").read_text(encoding="utf-8")


def test_generate_codex_hook_projection(tmp_path):
    generate_codex_hook_projection(tmp_path)
    hook_path = tmp_path / ".thoth" / "derived" / "codex-hooks.json"
    assert hook_path.exists()
    payload = json.loads(hook_path.read_text(encoding="utf-8"))
    start_hook = payload["hooks"]["SessionStart"][0]["hooks"][0]
    stop_hook = payload["hooks"]["Stop"][0]["hooks"][0]
    assert "thoth hook --host codex --event start" in start_hook["command"]
    assert "thoth hook --host codex --event stop" in stop_hook["command"]
    assert "thoth-codex-hook.sh" in start_hook["command"]
    assert "thoth-codex-hook.sh" in stop_hook["command"]


def test_generate_thoth_runtime(base_config, tmp_path):
    generate_thoth_runtime(base_config, tmp_path)
    manifest = json.loads((tmp_path / ".thoth" / "objects" / "project" / "project.json").read_text(encoding="utf-8"))
    assert manifest["payload"]["project"]["name"] == "UnitTestProject"
    assert manifest["payload"]["dashboard"]["port"] == 8501
    assert (tmp_path / ".thoth" / "docs" / "object-graph-summary.json").exists()
    assert (tmp_path / ".thoth" / ".gitignore").exists()
    assert "/runs/" in (tmp_path / ".thoth" / ".gitignore").read_text(encoding="utf-8")


def test_generate_pre_commit_config(base_config, tmp_path):
    generate_pre_commit_config(base_config, tmp_path)
    content = (tmp_path / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert "thoth-doctor" in content
    assert "thoth-sync" in content
    assert "bash scripts/thoth-cli.sh doctor --json" in content
    assert "bash scripts/thoth-cli.sh init --sync" in content


def test_generate_dashboard_writes_locale_selection(base_config, tmp_path):
    generate_dashboard(base_config, tmp_path)
    locale_file = tmp_path / "tools" / "dashboard" / "frontend" / "src" / "generated" / "locale.ts"
    assert locale_file.exists()
    assert "defaultLocale = 'en'" in locale_file.read_text(encoding="utf-8")


def test_generate_scripts(base_config, tmp_path):
    generate_scripts(base_config, tmp_path)
    thoth_cli = (tmp_path / "scripts" / "thoth-cli.sh").read_text(encoding="utf-8")
    session_end = (tmp_path / "scripts" / "session-end-check.sh").read_text(encoding="utf-8")
    assert "command -v thoth" in thoth_cli
    assert "THOTH_SOURCE_ROOT" in thoth_cli
    assert "Install drift" in thoth_cli
    assert "bash scripts/thoth-cli.sh init --sync" in session_end
    assert "bash scripts/thoth-cli.sh doctor" in session_end


def test_generate_tests(base_config, tmp_path):
    generate_tests(base_config, tmp_path)
    content = (tmp_path / "tests" / "test_structure.py").read_text(encoding="utf-8")
    assert ".thoth/objects/project/project.json" in content
    assert ".research-config.yaml" not in content


def test_audit_repository_state_detects_legacy_and_docs(tmp_path):
    (tmp_path / ".research-config.yaml").write_text("project:\n  name: Legacy\n", encoding="utf-8")
    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1").mkdir(parents=True)
    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1" / "legacy.yaml").write_text("id: legacy\n", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "notes.md").write_text("# Notes\n", encoding="utf-8")
    audit = audit_repository_state(tmp_path)
    assert audit["existing"]["research_config"] is True
    assert audit["legacy_research_task_files"] == [".agent-os/research-tasks/frontend/f1/legacy.yaml"]
    assert "docs/notes.md" in audit["docs_files"]


def test_build_init_preview_marks_legacy_for_removal(tmp_path):
    (tmp_path / ".research-config.yaml").write_text("project:\n  name: Legacy\n", encoding="utf-8")
    (tmp_path / ".agent-os" / "research-tasks").mkdir(parents=True)
    audit = audit_repository_state(tmp_path)
    preview = build_init_preview(tmp_path, audit)
    assert ".research-config.yaml" in preview["remove"]
    assert ".agent-os/research-tasks" in preview["remove"]
    assert ".thoth/objects/project/project.json" in preview["create"]


def test_build_init_preview_ignores_host_owned_codex_root(tmp_path):
    (tmp_path / ".codex").write_text("", encoding="utf-8")
    audit = audit_repository_state(tmp_path)
    preview = build_init_preview(tmp_path, audit)
    assert ".codex" not in preview["update"]
    assert ".thoth/derived/codex-hooks.json" in preview["create"]


def test_initialize_project_strict_cut_imports_legacy_and_removes_old_surface(base_config, tmp_path):
    legacy_task_dir = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1"
    legacy_task_dir.mkdir(parents=True)
    (tmp_path / ".research-config.yaml").write_text(
        yaml.safe_dump(
            {
                "project": {"name": "Legacy Project", "language": "en"},
                "dashboard": {"port": 8520},
                "research": {"directions": [{"id": "frontend", "label_en": "Frontend"}]},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (legacy_task_dir / "legacy.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "legacy-task",
                "title": "Legacy Task",
                "module": "f1",
                "direction": "frontend",
                "hypothesis": "Legacy result can be imported.",
                "phases": {
                    "experiment": {
                        "status": "completed",
                        "criteria": {
                            "metric": "score",
                            "threshold": 0.7,
                            "current": 0.9,
                            "direction": "higher_is_better",
                            "unit": "score",
                        },
                        "deliverables": [{"path": "reports/legacy.md", "type": "report", "description": "legacy"}],
                    }
                },
                "results": {
                    "verdict": "confirmed",
                    "evidence_paths": ["reports/legacy.md"],
                    "metrics": {"score": 0.9},
                    "conclusion_text": "Imported from legacy.",
                    "failure_analysis": None,
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    result = initialize_project(base_config, tmp_path)

    assert not (tmp_path / ".research-config.yaml").exists()
    assert not (tmp_path / ".agent-os" / "research-tasks").exists()
    task = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "legacy-task.json").read_text(encoding="utf-8"))
    verdict = json.loads((tmp_path / ".thoth" / "docs" / "work-results" / "legacy-task.result.json").read_text(encoding="utf-8"))
    assert task["payload"]["legacy_source_id"] == "legacy-import-legacy-task"
    assert task["payload"]["runnable"] is True
    assert verdict["source"] == "legacy_import"
    import_index = json.loads(
        (tmp_path / ".thoth" / "migrations" / result["migration_id"] / "legacy-import" / "index.json").read_text(encoding="utf-8")
    )
    assert import_index["imported_work_item_count"] == 1
    preview = json.loads((tmp_path / ".thoth" / "migrations" / result["migration_id"] / "preview.json").read_text(encoding="utf-8"))
    assert ".research-config.yaml" in preview["remove"]
    assert ".agent-os/research-tasks" in preview["remove"]


def test_preview_project_migration_writes_preview_without_authority(base_config, tmp_path):
    legacy_task_dir = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1"
    legacy_task_dir.mkdir(parents=True)
    (legacy_task_dir / "legacy.yaml").write_text("id: legacy-task\ntitle: Legacy Task\n", encoding="utf-8")

    result = preview_project_migration(base_config, tmp_path)

    migration_dir = tmp_path / ".thoth" / "migrations" / result["migration_id"]
    assert (migration_dir / "preview.json").exists()
    assert (migration_dir / "audit.json").exists()
    assert not (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()
    assert result["legacy_import"]["importable_count"] == 1
    assert result["legacy_import"]["items"][0]["target_work_id"] == "legacy-task"


def test_initialize_project_preserves_host_owned_codex_root(base_config, tmp_path):
    (tmp_path / ".codex").write_text("", encoding="utf-8")

    result = initialize_project(base_config, tmp_path)

    assert (tmp_path / ".codex").is_file()
    assert (tmp_path / ".thoth" / "derived" / "codex-hooks.json").exists()
    backup = tmp_path / ".thoth" / "migrations" / result["migration_id"] / "backup" / ".codex"
    displaced = tmp_path / ".thoth" / "migrations" / result["migration_id"] / "displaced" / ".codex"
    assert not backup.exists()
    assert not displaced.exists()
    preview = json.loads((tmp_path / ".thoth" / "migrations" / result["migration_id"] / "preview.json").read_text(encoding="utf-8"))
    assert ".codex" not in preview["update"]
    assert result["displaced_conflicts"] == []


def test_initialize_project_appends_gitignore_rules_idempotently(base_config, tmp_path):
    (tmp_path / ".gitignore").write_text("# user rules\ncustom.log\n", encoding="utf-8")
    (tmp_path / ".thoth").mkdir()
    (tmp_path / ".thoth" / ".gitignore").write_text("# user thoth rules\n/runs/\n", encoding="utf-8")

    initialize_project(base_config, tmp_path)
    sync_project_layer(tmp_path)
    sync_project_layer(tmp_path)

    root_ignore = (tmp_path / ".gitignore").read_text(encoding="utf-8")
    thoth_ignore = (tmp_path / ".thoth" / ".gitignore").read_text(encoding="utf-8")
    frontend_ignore = (tmp_path / "tools" / "dashboard" / "frontend" / ".gitignore").read_text(encoding="utf-8")
    root_lines = root_ignore.splitlines()
    thoth_lines = thoth_ignore.splitlines()
    frontend_lines = frontend_ignore.splitlines()

    assert "custom.log" in root_ignore
    assert root_lines.count("/research.db") == 1
    assert thoth_lines.count("/runs/") == 1
    assert thoth_lines.count("/objects/run/") == 1
    assert frontend_lines.count("node_modules/") == 1
    assert frontend_lines.count("dist/") == 1


def test_init_git_status_shows_authority_but_not_runtime_cache(base_config, tmp_path):
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True, text=True)

    initialize_project(base_config, tmp_path)
    (tmp_path / ".thoth" / "runs" / "run-local" / "state.json").parent.mkdir(parents=True)
    (tmp_path / ".thoth" / "runs" / "run-local" / "state.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".thoth" / "objects" / "run" / "run-local.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".thoth" / "objects" / "artifact" / "artifact-local.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".thoth" / "objects" / "controller" / "controller-local.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".thoth" / "objects" / "phase_result" / "phase-local.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".thoth" / "docs" / "work-results" / "work.result.json").parent.mkdir(parents=True, exist_ok=True)
    (tmp_path / ".thoth" / "docs" / "work-results" / "work.result.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".thoth" / "derived" / "dashboard.pid").write_text("123\n", encoding="utf-8")
    (tmp_path / "tools" / "dashboard" / "frontend" / "node_modules" / "pkg").mkdir(parents=True)
    (tmp_path / "tools" / "dashboard" / "frontend" / "node_modules" / "pkg" / "index.js").write_text("", encoding="utf-8")

    status = subprocess.run(
        ["git", "status", "--short", "--untracked-files=all"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    assert "?? .thoth/objects/project/project.json" in status
    assert "?? .thoth/.gitignore" in status
    assert ".thoth/runs/" not in status
    assert ".thoth/objects/run/" not in status
    assert ".thoth/objects/artifact/" not in status
    assert ".thoth/objects/controller/" not in status
    assert ".thoth/objects/phase_result/" not in status
    assert ".thoth/docs/work-results/" not in status
    assert ".thoth/derived/" not in status
    assert "node_modules/" not in status


def test_sync_project_layer_refreshes_dashboard_locale(tmp_path):
    config = {
        "name": "LocaleSyncProject",
        "language": "zh",
        "directions": [],
        "phases": DEFAULT_PHASES,
        "port": 8501,
        "theme": "warm-bear",
    }
    initialize_project(config, tmp_path)
    manifest_path = tmp_path / ".thoth" / "objects" / "project" / "project.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["payload"]["project"]["language"] = "en"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sync_project_layer(tmp_path)

    locale_file = tmp_path / "tools" / "dashboard" / "frontend" / "src" / "generated" / "locale.ts"
    assert "defaultLocale = 'en'" in locale_file.read_text(encoding="utf-8")


def test_sync_project_layer_updates_dashboard_with_ignored_backup(base_config, tmp_path):
    initialize_project(base_config, tmp_path)
    dashboard_file = tmp_path / "tools" / "dashboard" / "backend" / "progress_calculator.py"
    dashboard_file.write_text("drifted dashboard\n", encoding="utf-8")

    result = sync_project_layer(tmp_path)

    assert "drifted dashboard" not in dashboard_file.read_text(encoding="utf-8")
    backup = result["dashboard"]["backup"]
    assert backup is not None
    backup_path = tmp_path / backup["backup_path"] / "backend" / "progress_calculator.py"
    assert "drifted dashboard" in backup_path.read_text(encoding="utf-8")
    assert "/derived/" in (tmp_path / ".thoth" / ".gitignore").read_text(encoding="utf-8")

    dashboard_file.write_text("second drift\n", encoding="utf-8")
    second = sync_project_layer(tmp_path)
    assert second["dashboard"]["backup"]["backup_path"] != backup["backup_path"]


def test_sync_project_layer_backfills_legacy_discussion_authority(base_config, tmp_path):
    initialize_project(base_config, tmp_path)
    store = Store(tmp_path)
    closure = {
        "schema_version": 1,
        "source_discussion_id": "DISC-sync",
        "source_decision_ids": [],
        "semantic_events": [],
        "goal": "closed sync goal",
        "constraints": ["closed"],
        "accepted_decisions": [],
        "rejected_options": [],
        "acceptance": {"normalized_summary": "pytest passes"},
        "run_instructions": ["run pytest"],
        "open_questions": [],
        "completeness": {"is_closed": True, "unresolved_count": 0, "blocking_reasons": []},
    }
    store.create(
        kind="discussion",
        object_id="DISC-sync",
        status="closed",
        title="Closed sync authority",
        summary="Closed sync authority",
        source="test",
        payload={"closure": closure},
    )
    store.create(
        kind="work_item",
        object_id="legacy-work",
        status="ready",
        title="Legacy work",
        summary="Legacy work",
        source="test",
        payload={
            "work_kind": "execution",
            "runnable": True,
            "goal": "Run legacy work",
            "context": "DISC-sync closed",
            "constraints": ["local"],
            "execution_plan": ["edit", "test"],
            "eval_contract": {
                "entrypoint": {"command": "pytest -q"},
                "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift"],
                "validate_output_schema": default_validate_output_schema(),
            },
            "runtime_policy": {"loop": {"max_iterations": 1, "max_runtime_seconds": 60}},
            "scheduling": {"priority": 0},
            "decisions": ["DISC-sync"],
            "missing_questions": [],
        },
    )

    result = sync_project_layer(tmp_path)
    updated = store.read("work_item", "legacy-work")
    authority_context = updated["payload"]["authority_context"]

    assert authority_context["source_discussion_id"] == "DISC-sync"
    assert result["authority_repairs"][0]["work_id"] == "legacy-work"
