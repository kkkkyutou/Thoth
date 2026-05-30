"""Host-neutral public command specifications for Thoth."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CommandSpec:
    """Host-neutral public surface definition."""

    command_id: str
    summary: str
    argument_hint: str
    route_class: str = "mechanical_fast"
    intelligence_tier: str = "none"
    packet_authority_mode: str = "none"
    durable: bool = False
    supports_codex_executor: bool = False
    needs_hooks: bool = False
    needs_subagents: bool = False
    acceptance: str = "Script-backed acceptance only."
    allowed_tools: tuple[str, ...] = field(default_factory=tuple)
    scope_can: tuple[str, ...] = field(default_factory=tuple)
    scope_cannot: tuple[str, ...] = field(default_factory=tuple)
    lifecycle: tuple[str, ...] = field(default_factory=tuple)
    interaction_gaps: tuple[str, ...] = field(default_factory=tuple)
    internal_routes: tuple[str, ...] = field(default_factory=tuple)


COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        command_id="init",
        summary="Initialize, migrate, resync, or seed an intent discussion for canonical .thoth authority without taking ownership of repo-root `.codex`.",
        argument_hint="[--sync] [--migrate preview|apply] [--migrate --preview|--apply] [--config-json <json>] [--intent <text>] [--intent-file <path>] [--] [intent...]",
        route_class="hybrid_init",
        intelligence_tier="intent_sensitive",
        packet_authority_mode="result_envelope_or_command_packet",
        acceptance="Authority tree, host projections, Codex hook projection, dashboard, scripts, and tests are generated from one canonical source while repo-root `.codex` remains host-owned.",
        needs_hooks=True,
        scope_can=(
            "Create canonical .thoth project authority files",
            "Append idempotent ignore rules for local runtime evidence, dashboard cache, and dependencies",
            "Generate AGENTS.md and CLAUDE.md from the same renderer",
            "Generate a Codex hooks projection under .thoth/derived for global or repo-local host wiring",
            "Generate dashboard, tests, helper scripts, and config",
            "Capture natural-language project intent as an inquiring discussion without fabricating ready work",
        ),
        scope_cannot=(
            "Silently delete existing project files",
            "Treat repo-root .codex as a Thoth-managed authority directory",
            "Treat hooks as correctness-critical runtime dependencies",
        ),
        lifecycle=("preview", "render-authority", "render-projections", "verify"),
        interaction_gaps=("Project description", "Directions/phases", "Dashboard port/theme"),
    ),
    CommandSpec(
        command_id="run",
        summary="Start one strict run bound to `work_id@revision`; live runs foreground and `--sleep` detaches the same runtime driver.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--watch <run_id>] [--stop <run_id>] --work-id <work_id> [guidance...]",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        durable=True,
        supports_codex_executor=True,
        acceptance="A durable run object and ledger with plan/execute/validate/reflect phase_result artifacts exists under .thoth/objects and .thoth/runs/<run_id>; live and sleep share one runtime driver.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Edit", "Write", "Bash", "Task"),
        scope_can=(
            "Drive plan -> execute -> validate -> reflect through one RuntimeDriver",
            "Switch to detached monitor placement only with --sleep",
            "Write fixed phase artifacts and terminal results through the shared authority",
            "Stop or watch an existing run",
        ),
        scope_cannot=(
            "Use host session state as runtime truth",
            "Use detached live execution without --sleep",
        ),
        lifecycle=("prepare", "plan", "execute", "validate", "reflect", "attach/watch/stop", "acceptance"),
        interaction_gaps=("Ready work id with acceptance_spec",),
    ),
    CommandSpec(
        command_id="loop",
        summary="Start one bounded controller service whose parent creates four-phase child runs.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] --work-id <work_id> [guidance...]",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        durable=True,
        supports_codex_executor=True,
        acceptance="The parent loop run enforces child iteration count and wall-clock budget mechanically, records child run lineage, and stops immediately on the first validated child run.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Edit", "Write", "Bash", "Task"),
        scope_can=(
            "Create or resume a durable bounded loop orchestrator",
            "Attach/watch/stop through the same runtime state machine",
            "Delegate work to Codex without changing authority write shape",
        ),
        scope_cannot=(
            "Use detached live execution without --sleep",
            "Depend on subagents or hooks for correctness",
        ),
        lifecycle=("prepare", "loop-parent", "child-plan", "child-execute", "child-validate", "child-reflect", "attach/resume/watch/stop", "acceptance"),
        interaction_gaps=("Ready work id with acceptance_spec",),
    ),
    CommandSpec(
        command_id="argue",
        summary="Run an adversarial attacker/adjudicator discussion against an idea, work item, or decision.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--work-id <work_id>] [--decision-id <decision_id>] [--target-kind work_item|decision|idea --target-id <id>] [--apply-artifact <path>] <idea-or-query>",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="argument_record",
        durable=True,
        supports_codex_executor=True,
        acceptance="Two fresh worker sessions produce a full attack and independent adjudication, preserve artifacts, and never mutate authority unless the user explicitly confirms an apply step.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Bash", "Task"),
        scope_can=(
            "Resolve an idea, work item, or decision target",
            "Launch independent attacker and adjudicator worker sessions",
            "Write argument artifacts and authority patch previews",
        ),
        scope_cannot=(
            "Modify project source code",
            "Mutate work item or decision authority without explicit confirmation",
            "Treat the adjudication as run/auto acceptance",
        ),
        lifecycle=("resolve-target", "attack-worker", "adjudicator-worker", "record-artifacts", "optional-confirmed-apply"),
        internal_routes=("ambiguous_target=needs_input", "apply=explicit_confirmation_required"),
    ),
    CommandSpec(
        command_id="auto",
        summary="Run the DAG-first actionable work queue until ready/active/failed work is closed, paused, or stopped.",
        argument_hint="[--sleep] [--rounds <n>] [--scope all-open|ready] [--work-id <work_id> ...] [--watch <controller_id>] [--stop <controller_id>] [guidance...]",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        durable=True,
        supports_codex_executor=True,
        needs_subagents=True,
        acceptance="A controller object records request parameters, fixed work refs when provided, dynamic queue snapshots, and a cursor; active controllers reject parameter drift.",
        allowed_tools=("Read", "Glob", "Grep", "Edit", "Write", "Bash", "Task", "Monitor"),
        scope_can=("Execute ready work items through child loops", "Monitor active work", "Let a later new controller revisit failed work"),
        scope_cannot=("Auto-abandon work items", "Execute blocked or draft work", "Bypass execution-safety doctor preflight"),
        lifecycle=("execution-safety-preflight", "select-dag-work", "child-loop", "monitor", "pause/stop/terminal"),
    ),
    CommandSpec(
        command_id="status",
        summary="Show repo status and active durable runs from the shared ledger.",
        argument_hint="[--json] [--doctor] [--report] [--dashboard start|stop|rebuild]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Status reports repo health plus active/stale run summaries without replacing attach/watch.",
        scope_can=("Read .thoth authority and machine-local registry",),
        scope_cannot=("Infer runtime state from chat history",),
        lifecycle=("read", "summarize"),
    ),
    CommandSpec(
        command_id="discuss",
        summary="Discuss or record planning decisions without entering implementation execution.",
        argument_hint="<topic>",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="command_packet",
        acceptance="Closed planning output is recorded into discussion, decision, and work_item objects and may produce at most one work subtree without mutating code.",
        scope_can=("Update discussions, decisions, and work items", "Generate a complete work subtree"),
        scope_cannot=("Modify source code", "Create ready executable work while questions remain", "Modify work locked by active execution"),
        lifecycle=("inquire", "close", "write-object-subtree", "generate-doc-view"),
    ),
    CommandSpec(
        command_id="doctor",
        summary="Alias for `status --doctor`; strictly audit project health without writing authority.",
        argument_hint="[--quick] [--json] [--fix preview|apply] [--version]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Doctor validates .thoth authority and generated projections without assuming repo-root `.codex` is Thoth-managed.",
        scope_can=("Run health checks", "Verify generated surfaces"),
        scope_cannot=("Use missing hooks as a correctness failure by themselves", "Mutate project authority without explicit init --migrate --apply"),
        lifecycle=("audit", "report"),
    ),
    CommandSpec(
        command_id="dashboard",
        summary="Alias for `status --dashboard`; manage the local dashboard backed by .thoth ledgers.",
        argument_hint="[start|stop|rebuild]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Dashboard derives work state from portable authority plus local .thoth/runs data, without requiring runtime ledgers to be Git-tracked.",
        scope_can=("Start the dashboard", "Install frontend dependencies and rebuild dist", "Report dashboard endpoints"),
        scope_cannot=("Read host session state as runtime truth", "Use rebuild as scaffold template sync"),
        lifecycle=("serve",),
    ),
    CommandSpec(
        command_id="tui",
        summary="Open or snapshot the read-only terminal dashboard backed by shared Thoth providers.",
        argument_hint="[--snapshot-json] [--export-snapshots] [--snapshot-dir <path>] [--no-gpu] [--no-python-plugins] [--refresh <seconds>]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="TUI reads shared provider snapshots for authority, work items, runs, metrics, plugins, tools, and GPU state without mutating project authority or runtime ledgers.",
        scope_can=("Open the terminal dashboard", "Emit ANSI-free snapshot JSON", "Export visual snapshots for verification"),
        scope_cannot=("Mutate .thoth authority", "Stop, resume, or edit training/runtime artifacts", "Guess metrics paths without an extension manifest"),
        lifecycle=("read", "render"),
    ),
    CommandSpec(
        command_id="plugin",
        summary="Create, list, or validate project-local Dashboard/TUI extension plugins with local audit receipts.",
        argument_hint="create <plugin_id> [--title <title>] [--surface dashboard,tui] [--capability tool|metrics_provider|system_provider|tui_python_plugin] | list | validate [--fix]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Extension manifest schema v2 is preserved, schema v1 manifests are migrated through managed plugin actions, and create/validate operations write local action receipts.",
        scope_can=("Create a project-local extension plugin skeleton", "List extension manifest plugins", "Validate or migrate the extension manifest"),
        scope_cannot=("Load untrusted Python plugin code", "Use dashboard actions as project authority", "Overwrite arbitrary files outside .thoth/extensions/plugins"),
        lifecycle=("manifest-load", "validate", "write-receipt"),
    ),
)


COMMAND_SPECS_BY_ID = {spec.command_id: spec for spec in COMMAND_SPECS}

PUBLIC_CODEX_COMMANDS: tuple[str, ...] = tuple(spec.command_id for spec in COMMAND_SPECS)
