"""Audit-first init and sync orchestration."""

from __future__ import annotations

import json
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thoth.plan.compiler import compile_task_authority
from thoth.plan.authority_resolution import resolve_strict_task_authority
from thoth.plan.results import rebuild_work_results_from_runs
from thoth.plan.store import load_project_manifest, upsert_work_result
from thoth.objects import ActiveExecutionLock, Store, flatten_work_item, normalize_scheduling

from .audit import (
    LEGACY_CONFIG_FILE,
    _detect_language,
    _discover_directions,
    _read_yaml,
    audit_repository_state,
    detect_claude_bridge_permission,
)
from .generators import (
    DEFAULT_PHASES,
    _write_dashboard_locale_selection,
    generate_agent_os_docs,
    generate_codex_hook_projection,
    generate_dashboard,
    generate_host_projections,
    generate_milestones,
    generate_pre_commit_config,
    generate_scripts,
    generate_tests,
    generate_thoth_runtime,
)
from .migration import _backup_existing_path, _displace_existing_path, _managed_directory_conflicts, _remove_existing_path, _write_source_map
from .preview import build_init_preview

def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_config(requested: dict[str, Any], project_dir: Path, audit: dict[str, Any]) -> dict[str, Any]:
    legacy_config = _read_yaml(project_dir / LEGACY_CONFIG_FILE)
    manifest = load_project_manifest(project_dir)
    project_config = manifest.get("project", {})
    dashboard_config = manifest.get("dashboard", {})
    research_config = legacy_config.get("research", {})
    legacy_project_config = legacy_config.get("project", {})
    legacy_dashboard_config = legacy_config.get("dashboard", {})

    config = dict(requested)
    config.setdefault("name", project_config.get("name") or legacy_project_config.get("name") or audit.get("readme", {}).get("title") or project_dir.name)
    config.setdefault("description", project_config.get("description") or legacy_project_config.get("description") or audit.get("readme", {}).get("summary") or "")
    config.setdefault("language", project_config.get("language") or legacy_project_config.get("language") or audit.get("inferred", {}).get("language") or "zh")
    config.setdefault("directions", project_config.get("directions") or research_config.get("directions") or audit.get("inferred", {}).get("directions") or [])
    config.setdefault("phases", project_config.get("phases") or research_config.get("phases") or DEFAULT_PHASES)
    config.setdefault("port", dashboard_config.get("port", legacy_dashboard_config.get("port", 8501)))
    config.setdefault("theme", dashboard_config.get("theme", legacy_dashboard_config.get("theme", "warm-bear")))

    directions = config["directions"]
    if isinstance(directions, str):
        directions = [d.strip() for d in directions.split(",") if d.strip()]
    config["directions"] = directions
    return config


def initialize_project(config: dict[str, Any], project_dir: Path) -> dict[str, Any]:
    project_dir = project_dir.resolve()
    audit = audit_repository_state(project_dir)
    normalized = _normalize_config(config or {}, project_dir, audit)
    preview = build_init_preview(project_dir, audit)
    migration_id = f"mig-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    preview["migration_id"] = migration_id

    migrations_root = project_dir / ".thoth" / "migrations"
    migrations_root.mkdir(parents=True, exist_ok=True)
    migration_dir = migrations_root / migration_id
    migration_dir.mkdir(parents=True, exist_ok=True)

    (migration_dir / "audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (migration_dir / "preview.json").write_text(
        json.dumps(preview, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    backups: list[dict[str, Any]] = []
    for relpath in sorted(set(preview["update"] + preview.get("remove", []))):
        source = project_dir / relpath
        if not source.exists():
            continue
        _backup_existing_path(project_dir, migration_dir, relpath)
        backups.append(
            {
                "relative_path": relpath,
                "backup_path": str((Path("backup") / relpath).as_posix()),
            }
        )

    displaced_conflicts: list[dict[str, Any]] = []
    for relpath in _managed_directory_conflicts(project_dir):
        displaced_path = _displace_existing_path(project_dir, migration_dir, relpath)
        if displaced_path:
            displaced_conflicts.append(
                {
                    "relative_path": relpath,
                    "displaced_path": displaced_path,
                }
            )

    (project_dir / "reports").mkdir(exist_ok=True)
    generate_thoth_runtime(normalized, project_dir)
    generate_dashboard(normalized, project_dir)
    generate_pre_commit_config(normalized, project_dir)
    generate_scripts(normalized, project_dir)
    generate_host_projections(normalized, project_dir)
    generate_codex_hook_projection(project_dir)
    generate_tests(normalized, project_dir)
    legacy_import = import_legacy_work_items(project_dir, migration_dir)

    for relpath in preview.get("remove", []):
        _remove_existing_path(project_dir, relpath)

    _write_source_map(project_dir, audit, preview)
    compile_task_authority(project_dir)
    rebuild_work_results_from_runs(project_dir)

    rollback_payload = {
        "schema_version": 1,
        "migration_id": migration_id,
        "created_at": preview["generated_at"],
        "mode": preview["mode"],
        "created_paths": preview["create"],
        "removed_paths": preview.get("remove", []),
        "backup_targets": backups,
        "displaced_conflicts": displaced_conflicts,
    }
    (migration_dir / "rollback.json").write_text(
        json.dumps(rollback_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    apply_payload = {
        "schema_version": 1,
        "migration_id": migration_id,
        "applied_at": _utc_iso(),
        "mode": preview["mode"],
        "status": "applied",
        "created_count": len(preview["create"]),
        "updated_count": len(preview["update"]),
        "preserved_count": len(preview["preserve"]),
        "removed_count": len(preview.get("remove", [])),
        "displaced_conflict_count": len(displaced_conflicts),
    }
    (migration_dir / "apply.json").write_text(
        json.dumps(apply_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "migration_id": migration_id,
        "mode": preview["mode"],
        "config": normalized,
        "audit": audit,
        "preview": preview,
        "apply": apply_payload,
        "legacy_import": legacy_import,
        "claude_permissions": detect_claude_bridge_permission(project_dir),
        "displaced_conflicts": displaced_conflicts,
    }


def preview_project_migration(config: dict[str, Any], project_dir: Path) -> dict[str, Any]:
    project_dir = project_dir.resolve()
    audit = audit_repository_state(project_dir)
    normalized = _normalize_config(config or {}, project_dir, audit)
    preview = build_init_preview(project_dir, audit)
    migration_id = f"mig-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    preview["migration_id"] = migration_id
    preview["operation"] = "preview"
    preview["legacy_import_plan"] = build_legacy_import_plan(project_dir)
    migrations_root = project_dir / ".thoth" / "migrations"
    migrations_root.mkdir(parents=True, exist_ok=True)
    migration_dir = migrations_root / migration_id
    migration_dir.mkdir(parents=True, exist_ok=True)
    (migration_dir / "audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (migration_dir / "preview.json").write_text(json.dumps(preview, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "migration_id": migration_id,
        "mode": preview["mode"],
        "operation": "preview",
        "config": normalized,
        "audit": audit,
        "preview": preview,
        "legacy_import": {"status": "planned", **preview["legacy_import_plan"]},
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _legacy_yaml_paths(project_dir: Path) -> list[Path]:
    root = project_dir / ".agent-os" / "research-tasks"
    if not root.is_dir():
        return []
    return sorted(path for path in root.rglob("*.y*ml") if path.name not in {"_module.yaml", "paper-module-mapping.yaml"})


def _legacy_thoth_json_paths(project_dir: Path) -> list[Path]:
    root = project_dir / ".thoth" / "project"
    if not root.exists():
        return []
    return sorted(path for path in root.rglob("*.json") if path.is_file())


def build_legacy_import_plan(project_dir: Path) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for path in _legacy_yaml_paths(project_dir):
        payload = _read_yaml(path)
        task_id = payload.get("id") if isinstance(payload.get("id"), str) else path.stem
        rows.append(
            {
                "source_path": str(path.relative_to(project_dir)),
                "source_kind": "agent_os_research_task",
                "target_work_id": task_id,
                "checksum": _sha256(path),
            }
        )
    for path in _legacy_thoth_json_paths(project_dir):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        work_id = str(payload.get("work_id") or payload.get("task_id") or payload.get("contract_id") or path.stem)
        rows.append(
            {
                "source_path": str(path.relative_to(project_dir)),
                "source_kind": "legacy_thoth_project",
                "target_work_id": work_id,
                "checksum": _sha256(path),
            }
        )
    return {"importable_count": len(rows), "items": rows}


def _legacy_completed(payload: dict[str, Any]) -> bool:
    results = payload.get("results") if isinstance(payload.get("results"), dict) else {}
    if results.get("verdict") in {"confirmed", "completed", "passed", "validated"}:
        return True
    phases = payload.get("phases") if isinstance(payload.get("phases"), dict) else {}
    return bool(phases) and all(isinstance(value, dict) and value.get("status") == "completed" for value in phases.values())


def _legacy_work_payload(raw: dict[str, Any], *, source_path: str) -> tuple[str, str, str, dict[str, Any]]:
    work_id = str(raw.get("id") or raw.get("work_id") or raw.get("task_id") or raw.get("contract_id") or Path(source_path).stem)
    title = str(raw.get("title") or raw.get("goal") or work_id)
    goal = str(raw.get("hypothesis") or raw.get("goal") or raw.get("summary") or title)
    completed = _legacy_completed(raw)
    results = raw.get("results") if isinstance(raw.get("results"), dict) else {}
    evidence_paths = results.get("evidence_paths") if isinstance(results.get("evidence_paths"), list) else []
    metrics = results.get("metrics") if isinstance(results.get("metrics"), dict) else {}
    work_payload = {
        "goal": goal,
        "context": f"Imported from {source_path}",
        "constraints": ["Imported from legacy Thoth authority; preserve original intent."],
        "acceptance_spec": {
            "kind": "script",
            "description": "Review the migrated legacy task and run a focused Thoth status check before treating it as current execution authority.",
            "metric": {"name": "legacy_import_review", "direction": "gte", "threshold": 1},
            "reference_command": "python -m thoth.cli status --json",
        },
        "approach_notes": [
            "Review imported legacy task context.",
            "Run the migrated reference command or replace it with a task-specific validator before execution.",
        ],
        "run_limits": {"max_iterations": 10, "max_runtime_seconds": 28800},
        "scheduling": normalize_scheduling(raw.get("scheduling")),
        "missing_questions": [],
    }
    if not completed and not raw.get("hypothesis") and not raw.get("goal"):
        work_payload["missing_questions"] = ["Confirm migrated task goal before execution."]
    status = "validated" if completed else "ready" if not work_payload["missing_questions"] else "blocked"
    return work_id, title, status, {"payload": work_payload, "evidence_paths": evidence_paths, "metrics": metrics, "conclusion": results.get("conclusion_text")}


def import_legacy_work_items(project_dir: Path, migration_dir: Path) -> dict[str, Any]:
    store = Store(project_dir)
    store.ensure_tree()
    imported: list[dict[str, Any]] = []
    for path in _legacy_yaml_paths(project_dir):
        raw = _read_yaml(path)
        rel = str(path.relative_to(project_dir))
        work_id, title, status, converted = _legacy_work_payload(raw, source_path=rel)
        obj = store.upsert(
            kind="work_item",
            object_id=work_id,
            status=status,
            title=title,
            summary=str(converted["payload"]["goal"]),
            source="legacy_import",
            payload=converted["payload"],
            history_summary=f"imported legacy task from {rel}",
        )
        if status == "validated":
            upsert_work_result(
                project_dir,
                work_id,
                {
                    "status": "completed",
                    "source": "legacy_import",
                    "usable": True,
                    "meets_goal": True,
                    "evidence_paths": converted["evidence_paths"],
                    "recent_evidence": converted["evidence_paths"],
                    "metrics": converted["metrics"],
                    "conclusion": converted["conclusion"],
                    "current_summary": converted["conclusion"],
                },
            )
        imported.append({"source_path": rel, "target_work_id": work_id, "status": obj.get("status"), "checksum": _sha256(path)})
    for path in _legacy_thoth_json_paths(project_dir):
        rel = str(path.relative_to(project_dir))
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = {}
        if not isinstance(raw, dict):
            raw = {}
        work_id, title, status, converted = _legacy_work_payload(raw, source_path=rel)
        obj = store.upsert(
            kind="work_item",
            object_id=work_id,
            status="blocked",
            title=title,
            summary=str(converted["payload"]["goal"]),
            source="legacy_import",
            payload={**converted["payload"], "missing_questions": ["Review imported legacy JSON before execution."]},
            history_summary=f"imported legacy Thoth JSON from {rel}",
        )
        imported.append({"source_path": rel, "target_work_id": work_id, "status": obj.get("status"), "checksum": _sha256(path)})
    import_dir = migration_dir / "legacy-import"
    import_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "generated_at": _utc_iso(),
        "imported_work_item_count": len(imported),
        "items": imported,
    }
    (import_dir / "index.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"status": "imported", **payload}


def sync_project_layer(project_dir: Path) -> dict[str, Any] | None:
    """Regenerate project-local projections from canonical authority/config."""
    manifest = load_project_manifest(project_dir)
    project = manifest.get("project", {}) if isinstance(manifest, dict) else {}
    dashboard = manifest.get("dashboard", {}) if isinstance(manifest, dict) else {}
    if not project:
        return
    normalized = {
        "name": project.get("name", project_dir.name),
        "description": project.get("description", ""),
        "language": project.get("language", "zh"),
        "directions": project.get("directions", []),
        "phases": project.get("phases", DEFAULT_PHASES),
        "port": dashboard.get("port", 8501),
        "theme": dashboard.get("theme", "warm-bear"),
    }
    generate_thoth_runtime(normalized, project_dir)
    authority_repairs = backfill_work_item_authority_contexts(project_dir)
    duplicate_repairs = abandon_duplicate_timestamp_work_items(project_dir)
    dashboard_result = generate_dashboard(normalized, project_dir, backup_existing=True)
    _write_dashboard_locale_selection(normalized, project_dir)
    generate_host_projections(normalized, project_dir)
    generate_codex_hook_projection(project_dir)
    audit = audit_repository_state(project_dir)
    preview = build_init_preview(project_dir, audit)
    _write_source_map(project_dir, audit, preview)
    compile_task_authority(project_dir)
    return {
        "authority_repairs": authority_repairs,
        "duplicate_work_repairs": duplicate_repairs,
        "dashboard": dashboard_result,
        "source_map": str(project_dir / ".thoth" / "docs" / "source-map.json"),
    }


_TIMESTAMP_WORK_ID_RE = re.compile(r"^work-\d{8}T\d{6}Z-work$")


def _work_duplicate_signature(obj: dict[str, Any]) -> tuple[str, str, str, str]:
    payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
    acceptance_spec = payload.get("acceptance_spec") if isinstance(payload.get("acceptance_spec"), dict) else {}
    command = acceptance_spec.get("reference_command")
    if not isinstance(command, str):
        eval_contract = payload.get("eval_contract") if isinstance(payload.get("eval_contract"), dict) else {}
        entrypoint = eval_contract.get("entrypoint") if isinstance(eval_contract.get("entrypoint"), dict) else {}
        command = entrypoint.get("command")
    return (
        " ".join(str(payload.get("goal") or obj.get("summary") or "").split()),
        " ".join(str(command or "").split()),
        str(payload.get("context") or payload.get("module") or "").strip(),
        str((acceptance_spec.get("kind") if isinstance(acceptance_spec, dict) else "") or payload.get("direction") or "").strip(),
    )


def abandon_duplicate_timestamp_work_items(project_dir: Path) -> list[dict[str, Any]]:
    """Mark legacy timestamp work items as superseded by stable work ids.

    Early discuss workers could close an existing work item without preserving
    its stable work_id, producing `work-<timestamp>-work` duplicates.  Sync keeps
    those objects as evidence but removes them from ready/dashboard authority.
    """

    store = Store(project_dir)
    rows = store.list("work_item")
    stable_by_signature: dict[tuple[str, str, str, str], list[dict[str, Any]]] = {}
    timestamp_rows: list[dict[str, Any]] = []
    for obj in rows:
        work_id = str(obj.get("object_id") or "")
        if _TIMESTAMP_WORK_ID_RE.match(work_id):
            timestamp_rows.append(obj)
            continue
        if obj.get("status") == "abandoned":
            continue
        signature = _work_duplicate_signature(obj)
        if not signature[0] or not signature[1]:
            continue
        stable_by_signature.setdefault(signature, []).append(obj)

    repairs: list[dict[str, Any]] = []
    for duplicate in timestamp_rows:
        duplicate_id = str(duplicate.get("object_id") or "")
        signature = _work_duplicate_signature(duplicate)
        candidates = stable_by_signature.get(signature, [])
        if len(candidates) != 1:
            repairs.append({"work_id": duplicate_id, "status": "skipped_ambiguous", "candidate_count": len(candidates)})
            continue
        stable = candidates[0]
        stable_id = str(stable.get("object_id") or "")
        superseded_by = f"work_item:{stable_id}"
        latest_stable = store.read("work_item", stable_id) or stable
        stable_links = list(latest_stable.get("links") if isinstance(latest_stable.get("links"), list) else [])
        supersedes_link = {"type": "supersedes", "target": f"work_item:{duplicate_id}"}
        if duplicate.get("status") == "abandoned" and supersedes_link in stable_links:
            repairs.append({"work_id": duplicate_id, "status": "already_abandoned", "superseded_by": stable_id})
            continue
        try:
            updated_duplicate = store.update(
                "work_item",
                duplicate_id,
                expected_revision=int(duplicate.get("revision", 0)),
                updates={"status": "abandoned", "summary": f"Duplicate timestamp work item superseded by {superseded_by}."},
                history_summary="sync abandoned duplicate timestamp work item",
                source="init --sync",
            )
            if supersedes_link not in stable_links:
                stable_links.append(supersedes_link)
                store.update(
                    "work_item",
                    stable_id,
                    expected_revision=int(latest_stable.get("revision", 0)),
                    updates={"links": stable_links},
                    history_summary=f"sync linked superseded duplicate {duplicate_id}",
                    source="init --sync",
                )
            repairs.append(
                {
                    "work_id": duplicate_id,
                    "status": "abandoned",
                    "superseded_by": stable_id,
                    "revision": updated_duplicate.get("revision"),
                }
            )
        except ActiveExecutionLock:
            repairs.append({"work_id": duplicate_id, "status": "skipped_active", "superseded_by": stable_id})
    return repairs


def backfill_work_item_authority_contexts(project_dir: Path) -> list[dict[str, Any]]:
    """Persist closed discussion authority links into legacy ready work items during sync."""

    store = Store(project_dir)
    repairs: list[dict[str, Any]] = []
    for obj in store.list("work_item"):
        work_id = str(obj.get("object_id") or "")
        if not work_id:
            continue
        existing_links = obj.get("links") if isinstance(obj.get("links"), list) else []
        if any(
            isinstance(link, dict)
            and link.get("type") == "primary_parent"
            and str(link.get("target") or "").startswith("discussion:")
            for link in existing_links
        ):
            continue
        payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
        legacy_context = payload.get("authority_context") if isinstance(payload.get("authority_context"), dict) else {}
        legacy_source_discussion_id = legacy_context.get("source_discussion_id")
        resolution: dict[str, Any] = {}
        if isinstance(legacy_source_discussion_id, str) and legacy_source_discussion_id.strip() and store.read("discussion", legacy_source_discussion_id):
            source_discussion_id = legacy_source_discussion_id
            resolution = {"source": "legacy_payload_authority_context", "source_ids": [legacy_source_discussion_id]}
        else:
            try:
                strict_task = flatten_work_item(obj)
                strict_task.pop("authority_context", None)
                enriched, resolution = resolve_strict_task_authority(
                    project_dir,
                    strict_task,
                    allow_work_item_fallback=False,
                )
            except (ValueError, ActiveExecutionLock):
                continue
            authority_context = enriched.get("authority_context")
            if not isinstance(authority_context, dict):
                continue
            source_discussion_id = authority_context.get("source_discussion_id")
        if not isinstance(source_discussion_id, str) or not source_discussion_id.strip():
            continue
        next_links = [
            link
            for link in existing_links
            if isinstance(link, dict)
            and not (link.get("type") == "primary_parent" and str(link.get("target") or "").startswith("discussion:"))
        ]
        next_links.append({"type": "primary_parent", "target": f"discussion:{source_discussion_id}"})
        try:
            store.update(
                "work_item",
                work_id,
                expected_revision=int(obj.get("revision", 0)),
                updates={"links": next_links},
                history_summary="sync backfilled closed authority link",
                source="init --sync",
            )
        except ActiveExecutionLock:
            repairs.append({"work_id": work_id, "status": "skipped_active"})
            continue
        repairs.append(
            {
                "work_id": work_id,
                "status": "backfilled",
                "source": resolution.get("source"),
                "source_ids": resolution.get("source_ids", []),
            }
        )
    return repairs
