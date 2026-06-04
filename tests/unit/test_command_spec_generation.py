"""Tests for host-neutral command spec projections."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.command_specs import COMMAND_SPECS, PUBLIC_CODEX_COMMANDS
from thoth.projections import (
    PLUGIN_VERSION,
    PLUGIN_PACKAGE_DIR,
    PLUGIN_SKILLS_PATH,
    render_claude_command,
    render_claude_marketplace,
    render_claude_plugin_manifest,
    render_codex_marketplace,
    render_codex_agent_metadata,
    render_codex_skill,
    render_plugin_manifest,
    sync_repository_surfaces,
)
from thoth.prompt_specs import COMMAND_PROMPT_SPECS, codex_installed_runtime_shell_command


ROOT = Path(__file__).parent.parent.parent


def test_claude_surface_renders_from_spec():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "run")
    rendered = render_claude_command(spec)
    assert "name: thoth:run" in rendered
    assert "disable-model-invocation: false" in rendered
    assert "allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Task" in rendered
    assert "THOTH_RUN_ARGUMENTS_FILE" in rendered
    assert 'scripts/thoth-claude-command.sh" run --host claude --thoth-arguments-file "$THOTH_RUN_ARGUMENTS_FILE"' in rendered
    assert "RuntimeDriver advances phases" in rendered
    assert "do not invent, create, compile, or guess a work item" in rendered
    assert "Substantive execution must flow through `packet.executor`" in rendered
    assert "actively produce canonical acceptance evidence" in rendered
    assert "short observation window" in rendered
    assert "concrete root cause, blocker, or budget boundary" in rendered
    assert "every 288s" in rendered
    assert "## Authority Summary" in rendered
    assert "route_class: `live_intelligent`" in rendered
    assert "packet_authority_mode: `phase_controller`" in rendered
    assert "plan -> execute -> validate -> reflect" in rendered


def test_claude_init_surface_documents_positional_migration_actions():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "init")
    rendered = render_claude_command(spec)
    assert "argument-hint: \"[--sync] [--migrate preview|apply] [--migrate --preview|--apply] [--config-json <json>] [--intent <text>] [--intent-file <path>] [--] [intent...]\"" in rendered
    assert "disable-model-invocation: false" in rendered
    assert "route_class: `hybrid_init`" in rendered
    assert "THOTH_INIT_ARGUMENTS_FILE" in rendered
    assert "If extra evidence is required, inspect only the smallest artifact explicitly named by the bridge payload." in rendered
    assert "Do not launch broad Explore, Task, cache/source scans, or background investigation after the bridge result." in rendered
    assert "Use AskUserQuestion to ask the next material question" in rendered
    assert "Do not assume goals, project identity, migration intent, work ordering, unblock policy, or acceptance criteria." in rendered
    assert "Do not turn init intent into ready work immediately." in rendered
    assert "project_patch" in rendered
    assert "work_graph" in rendered


def test_claude_doctor_surface_keeps_post_result_checks_minimal():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "doctor")
    rendered = render_claude_command(spec)
    assert "argument-hint: \"[--quick] [--json] [--fix preview|apply] [--version]\"" in rendered
    assert "If stdout starts with `version=`, repeat stdout exactly and output nothing else." in rendered
    assert "If extra evidence is required, inspect only the smallest artifact explicitly named by the bridge payload." in rendered
    assert "Do not launch broad Explore, Task, cache/source scans, or background investigation after the bridge result." in rendered
    assert "If extra evidence is required, inspect only the smallest artifact explicitly named by the doctor payload." in rendered
    assert "If work items are blocked or migration decisions are unresolved, ask with AskUserQuestion instead of guessing or fixing." in rendered


def test_review_feedback_hard_stops_are_absolute():
    assert "Do not exit the monitoring session before the RuntimeDriver signals a terminal state." in COMMAND_PROMPT_SPECS["run"].hard_stops
    assert "Do not proceed to the next loop iteration before the validator signals terminal." in COMMAND_PROMPT_SPECS["loop"].hard_stops
    assert (
        "Do not omit the failure point or fabricate a runtime delta; when the result is clean, report the absence of failure as the finding."
        in COMMAND_PROMPT_SPECS["dashboard"].hard_stops
    )


def test_claude_discuss_surface_preserves_structured_arguments():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "discuss")
    rendered = render_claude_command(spec)
    assert "THOTH_DISCUSS_ARGUMENTS_FILE" in rendered
    assert "<<'THOTH_DISCUSS_ARGUMENTS_EOF'" in rendered
    assert 'scripts/thoth-claude-command.sh" discuss --thoth-arguments-file "$THOTH_DISCUSS_ARGUMENTS_FILE"' in rendered
    assert 'scripts/thoth-claude-command.sh" discuss $ARGUMENTS' not in rendered
    assert "no material assumptions remain" in rendered
    assert "packet.protocol_commands.close_authority" in rendered
    assert "Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority." in rendered
    assert "packet.work_graph_schema" in rendered
    assert "disable-model-invocation: false" in rendered


def test_claude_argue_surface_preserves_adversarial_contract():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "argue")
    rendered = render_claude_command(spec)
    assert 'scripts/thoth-claude-command.sh" argue --host claude --thoth-arguments-file "$THOTH_ARGUE_ARGUMENTS_FILE"' in rendered
    assert "allowed-tools: Read, Glob, Grep, Bash, Task" in rendered
    assert "attacker/adjudicator output" in rendered
    assert "target resolution is ambiguous" in rendered
    assert "ask for explicit confirmation" in rendered
    assert "decision_impact" in rendered
    assert "route_class: `live_intelligent`" in rendered
    assert "packet_authority_mode: `argument_record`" in rendered


def test_claude_auto_surface_documents_monitor_watch_contract():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "auto")
    rendered = render_claude_command(spec)
    assert "allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Task, Monitor" in rendered
    assert "body.monitor_command" in rendered
    assert "Monitor tool with `persistent=true`" in rendered
    assert "same watch command in the foreground" in rendered
    assert "every 288s" in rendered
    assert "actively produce canonical acceptance evidence" in rendered
    assert "do not stop the auto controller" in rendered


def test_codex_skill_lists_single_public_entry():
    content = render_codex_skill()
    assert content.startswith("---\nname: thoth\n")
    assert "$thoth <command>" in content
    assert "## Dispatcher" in content
    assert "./commands/<command>.md" in content
    assert "installed Codex plugin cache or marketplace-root runtime entrypoint" in content
    assert "## Route Table" in content
    assert "`init` -> `hybrid_init` / `intent_sensitive` / `result_envelope_or_command_packet`" in content
    assert "## Command Contracts" not in content
    assert "### `$thoth run`" not in content
    for command in PUBLIC_CODEX_COMMANDS:
        assert f"$thoth {command}" in content
    for internal in ("sync", "report", "extend", "orchestration"):
        assert f"$thoth {internal}" not in content


def test_extension_surface_is_generated_from_shared_specs():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "extension")
    rendered = render_claude_command(spec)
    content = render_codex_skill()

    assert "name: thoth:extension" in rendered
    assert "experiment register" in rendered
    assert "manifest schema v3" in rendered
    assert "$thoth extension" in content
    assert "$thoth plugin" not in content
    assert "extension` -> `mechanical_fast` / `none` / `result_envelope" in content


def test_codex_runtime_shell_command_uses_installed_plugin_cache_without_checkout_fallback():
    command = codex_installed_runtime_shell_command("$thoth run --executor codex --work-id task-1")
    assert "command -v thoth" in command
    assert ".codex/plugins/cache/thoth/thoth" in command
    assert ".codex/plugins/cache/thoth/*" in command
    assert ".codex/plugins/cache/*/thoth/*" in command
    assert ".codex/plugins/cache/*/Thoth/*" in command
    assert ".codex/.tmp/marketplaces/thoth" in command
    assert "scripts/thoth-cli-entry.py" in command
    assert "--work-id task-1" in command
    assert "THOTH_SOURCE_ROOT" not in command


def test_prompt_surface_size_regression():
    run_spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "run")
    argue_spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "argue")
    codex_skill = render_codex_skill()
    claude_run = render_claude_command(run_spec)
    claude_argue = render_claude_command(argue_spec)

    assert len(codex_skill) < 5000
    assert len(claude_run) < 4600
    assert len(claude_argue) < 3500


def test_codex_agent_metadata_uses_single_public_entry():
    content = render_codex_agent_metadata()
    assert 'display_name: "thoth"' in content
    assert "Use $thoth as the single public entrypoint" in content


def test_plugin_manifest_matches_official_schema_shape():
    manifest = render_plugin_manifest()
    assert manifest["name"] == "thoth"
    assert manifest["version"] == PLUGIN_VERSION
    assert manifest["skills"] == PLUGIN_SKILLS_PATH
    assert manifest["interface"]["displayName"] == "Thoth"
    assert manifest["interface"]["defaultPrompt"][0].startswith("Show the current Thoth")
    for removed_field in {"schema_version", "display_name", "entrypoint", "public_skill_path", "commands"}:
        assert removed_field not in manifest


def test_claude_manifests_use_shared_plugin_version():
    manifest = render_claude_plugin_manifest()
    marketplace = render_claude_marketplace()
    assert manifest["version"] == PLUGIN_VERSION
    assert marketplace["plugins"][0]["version"] == PLUGIN_VERSION
    assert marketplace["plugins"][0]["source"] == "./"


def test_codex_marketplace_points_to_plugin_package():
    marketplace = render_codex_marketplace()
    assert marketplace["name"] == "thoth"
    assert marketplace["plugins"][0]["name"] == "thoth"
    assert marketplace["plugins"][0]["source"]["path"] == PLUGIN_PACKAGE_DIR
    assert marketplace["plugins"][0]["policy"]["installation"] == "AVAILABLE"
    assert marketplace["plugins"][0]["policy"]["authentication"] == "ON_INSTALL"


def test_sync_repository_surfaces_writes_generated_files(tmp_path):
    (tmp_path / "commands").mkdir()
    written = sync_repository_surfaces(tmp_path)
    assert tmp_path / "commands" / "run.md" in written
    assert (tmp_path / ".agents" / "plugins" / "marketplace.json").exists()
    assert (tmp_path / "plugins" / "thoth" / "skills" / "thoth" / "SKILL.md").exists()
    assert (tmp_path / "plugins" / "thoth" / "skills" / "thoth" / "commands" / "run.md").exists()
    assert not (tmp_path / "commands" / "sync.md").exists()
    assert not (tmp_path / "plugins" / "thoth" / "skills" / "thoth" / "commands" / "sync.md").exists()
    assert (tmp_path / "plugins" / "thoth" / "skills" / "thoth" / "agents" / "openai.yaml").exists()
    manifest = json.loads((tmp_path / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert manifest["skills"] == PLUGIN_SKILLS_PATH
    claude_manifest = json.loads((tmp_path / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    claude_marketplace = json.loads((tmp_path / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8"))
    assert claude_manifest["version"] == PLUGIN_VERSION
    assert claude_marketplace["plugins"][0]["version"] == PLUGIN_VERSION
