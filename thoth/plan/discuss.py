"""Discussion authority capture and closure helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thoth.plan.compiler import compile_task_authority
from thoth.objects import (
    ActiveExecutionLock,
    SchemaError,
    Store,
    active_work_ids,
    docs_root,
    slugify,
    utc_now,
    work_item_from_payload,
    work_item_input_ready_errors,
)

from .store import create_discussion_placeholder, upsert_decision, upsert_work_item


SEMANTIC_EVENT_TYPES = {
    "goal",
    "non_goal",
    "constraint",
    "decision",
    "rejected_option",
    "acceptance",
    "context",
    "risk",
    "open_question",
    "run_instruction",
}

COMPACT_AUTHORITY_CATEGORIES = (
    "goal",
    "constraints",
    "decisions",
    "risks",
    "approach_notes",
    "open_questions",
)

PUBLIC_WORK_JSON_REQUIRED_FIELDS = (
    "goal",
    "acceptance_spec",
)

WORK_GRAPH_NODE_FIELDS = (
    "title",
    "goal",
    "context",
    "constraints",
    "acceptance_spec",
    "approach_notes",
    "missing_questions",
)

WORK_GRAPH_EDGE_FIELDS = ("from", "to", "type")

PROJECT_PATCH_FIELDS = ("name", "description", "directions")

_CONTINUATION_HINTS = (
    "continue",
    "continuation",
    "follow up",
    "follow-up",
    "same discussion",
    "append",
    "继续",
    "续上",
    "接着",
    "刚才",
    "上面",
    "同一个讨论",
)


def _normalize_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _stable_id(prefix: str, value: str) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{slugify(value)[:24]}"


def example_minimal_ready_work_item() -> dict[str, Any]:
    return {
        "work_id": "replace-with-stable-work-id",
        "title": "Replace With Work Title",
        "status": "ready",
        "goal": "One concrete, user-authorized outcome.",
        "context": "module-or-scope",
        "constraints": ["Known hard constraint."],
        "acceptance_spec": {
            "kind": "script",
            "description": "Run the focused validator and satisfy its acceptance checks.",
            "metric": {"name": "checks", "direction": "gte", "threshold": 1},
            "reference_command": "pytest -q tests/path_or_nodeid.py",
        },
        "approach_notes": ["Use the smallest final implementation slice that satisfies the acceptance spec."],
        "run_limits": {"max_iterations": 1, "max_runtime_seconds": 28800},
        "scheduling": {"order": None},
        "decisions": ["DEC-replace-with-frozen-decision"],
        "missing_questions": [],
    }


def example_blocked_work_item() -> dict[str, Any]:
    payload = example_minimal_ready_work_item()
    payload.update(
        {
            "work_id": "replace-with-blocked-work-id",
            "status": "blocked",
            "missing_questions": ["Name the validator command or acceptance evidence."],
        }
    )
    return payload


def work_json_template() -> dict[str, Any]:
    return {
        "required_work_json_fields": list(PUBLIC_WORK_JSON_REQUIRED_FIELDS),
        "work_json_template": example_minimal_ready_work_item(),
        "example_minimal_ready_work_item": example_minimal_ready_work_item(),
        "example_blocked_work_item": example_blocked_work_item(),
    }


def work_graph_template() -> dict[str, Any]:
    return {
        "work_graph_schema": {
            "nodes": {
                "WORK-ID": {
                    "title": "Human title",
                    "goal": "Concrete user-authorized outcome.",
                    "context": "Optional compact scope string.",
                    "constraints": ["Hard constraint."],
                    "acceptance_spec": {
                        "kind": "script",
                        "description": "Focused acceptance check.",
                        "metric": {"name": "checks", "direction": "gte", "threshold": 1},
                        "reference_command": "pytest -q tests/path_or_nodeid.py",
                    },
                    "approach_notes": ["Implementation note."],
                    "missing_questions": [],
                }
            },
            "edges": [{"from": "UPSTREAM-WORK-ID", "to": "DOWNSTREAM-WORK-ID"}],
            "edge_semantics": "`to` depends on `from`; hard dependencies only.",
            "node_allowed_fields": list(WORK_GRAPH_NODE_FIELDS),
        }
    }


def project_patch_template() -> dict[str, Any]:
    return {
        "init_project_patch_schema": {
            "allowed_only_for": "discussion.source starts with init:",
            "allowed_fields": list(PROJECT_PATCH_FIELDS),
            "example": {
                "name": "Project Name",
                "description": "One compact project description.",
                "directions": [{"id": "core", "label_en": "Core"}],
            },
        }
    }


def _missing_work_json_fields(work_payload: dict[str, Any] | None) -> list[str]:
    if not isinstance(work_payload, dict) or not work_payload:
        return list(PUBLIC_WORK_JSON_REQUIRED_FIELDS)
    missing: list[str] = []
    for field in PUBLIC_WORK_JSON_REQUIRED_FIELDS:
        value = work_payload.get(field)
        if value in (None, "", [], {}):
            missing.append(field)
    return missing


def close_needs_input_diagnostics(
    *,
    authority_context: dict[str, Any],
    work_payload: dict[str, Any] | None,
    ready_errors: list[str] | None = None,
    extra_missing_items: list[str] | None = None,
    extra_ready_errors: list[str] | None = None,
) -> dict[str, Any]:
    open_questions = _normalize_string_list(authority_context.get("open_questions"))
    missing_fields = _missing_work_json_fields(work_payload)
    ready_error_rows = list(ready_errors or [])
    missing_items: list[str] = []
    if not isinstance(work_payload, dict) or not work_payload:
        missing_items.append("work_item")
    if open_questions:
        missing_items.append("open_questions")
    if missing_fields:
        missing_items.append("work_item_fields")
    if ready_error_rows:
        missing_items.append("work_item_ready_errors")
    for item in extra_missing_items or []:
        if item:
            missing_items.append(item)
    if extra_ready_errors:
        ready_error_rows.extend(extra_ready_errors)
        missing_items.append("authority_compile_errors")
    next_minimal_json: dict[str, Any] = {
        "open_questions": [],
        "completeness": {"is_closed": True},
    }
    if "work_item" in missing_items or ready_error_rows or missing_fields:
        next_minimal_json["work_item"] = example_minimal_ready_work_item()
    return {
        "missing_items": sorted(set(missing_items)),
        "open_questions": open_questions,
        "missing_work_json_fields": missing_fields,
        "work_item_ready_errors": ready_error_rows,
        "next_minimal_json": next_minimal_json,
    }


def _discussion_candidate_from_object(obj: dict[str, Any]) -> dict[str, Any]:
    payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
    messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    return {
        "discussion_id": str(obj.get("object_id") or ""),
        "status": str(obj.get("status") or ""),
        "title": str(obj.get("title") or obj.get("summary") or obj.get("object_id") or ""),
        "summary": str(obj.get("summary") or ""),
        "updated_at": str(obj.get("updated_at") or ""),
        "message_count": len(messages),
        "open_questions": _normalize_string_list(payload.get("open_questions")),
        "_path": str(obj.get("_path") or ""),
    }


def open_discussion_candidates(project_root: Path, *, limit: int = 5) -> list[dict[str, Any]]:
    rows = [
        _discussion_candidate_from_object(item)
        for item in Store(project_root).list("discussion")
        if item.get("status") == "inquiring"
    ]
    rows.sort(key=lambda item: (item.get("updated_at") or "", item.get("discussion_id") or ""), reverse=True)
    return rows[: max(0, limit)]


def open_init_discussion_candidates(project_root: Path, *, limit: int = 5) -> list[dict[str, Any]]:
    rows = [
        _discussion_candidate_from_object(item)
        for item in Store(project_root).list("discussion")
        if item.get("status") == "inquiring" and str(item.get("source") or "").startswith("init:")
    ]
    rows.sort(key=lambda item: (item.get("updated_at") or "", item.get("discussion_id") or ""), reverse=True)
    return rows[: max(0, limit)]


def match_open_discussion_for_message(project_root: Path, content: str) -> dict[str, Any] | None:
    normalized = content.lower()
    candidates = open_discussion_candidates(project_root, limit=5)
    for candidate in candidates:
        discussion_id = str(candidate.get("discussion_id") or "")
        if discussion_id and discussion_id.lower() in normalized:
            return candidate
    if any(hint in normalized for hint in _CONTINUATION_HINTS):
        return candidates[0] if candidates else None
    return None


def append_discussion_message(
    project_root: Path,
    *,
    discussion_id: str,
    content: str,
    host: str = "codex",
) -> dict[str, Any]:
    store = Store(project_root)
    current = store.read("discussion", discussion_id)
    if not current:
        raise FileNotFoundError(f"discussion:{discussion_id} not found")
    if current.get("status") != "inquiring":
        raise ValueError(f"discussion:{discussion_id} is not open")
    payload = _discussion_payload(current)
    messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    payload["messages"] = [
        *messages,
        {"role": "user", "content": content, "created_at": utc_now(), "host": host},
    ]
    payload["last_message_at"] = utc_now()
    updated = store.update(
        "discussion",
        discussion_id,
        expected_revision=int(current.get("revision", 0)),
        updates={
            "summary": str(current.get("summary") or current.get("title") or discussion_id),
            "payload": payload,
        },
        history_summary="discussion message appended",
        source=f"discuss:{host}",
    )
    candidate = _discussion_candidate_from_object(updated)
    candidate.update(
        {
            "schema_version": updated.get("schema_version"),
            "kind": "discussion",
            "object_id": updated.get("object_id"),
            "question": updated.get("summary") or updated.get("title"),
            "unresolved_gaps": candidate["open_questions"],
            "_path": str(store.path("discussion", discussion_id)),
        }
    )
    return candidate


def open_or_append_init_discussion(project_root: Path, content: str, *, host: str = "codex") -> dict[str, Any]:
    candidates = open_init_discussion_candidates(project_root, limit=1)
    if candidates:
        appended = append_discussion_message(
            project_root,
            discussion_id=str(candidates[0]["discussion_id"]),
            content=content,
            host=host,
        )
        store = Store(project_root)
        current = store.read("discussion", str(appended["discussion_id"]))
        if current:
            payload = _discussion_payload(current)
            raw_intents = payload.get("raw_intents") if isinstance(payload.get("raw_intents"), list) else []
            if not raw_intents and isinstance(payload.get("raw_intent"), str) and payload["raw_intent"].strip():
                raw_intents = [payload["raw_intent"]]
            raw_intents = [*raw_intents, content]
            payload["raw_intents"] = raw_intents
            payload["raw_intent"] = "\n\n".join(item for item in raw_intents if isinstance(item, str) and item.strip())
            updated = store.update(
                "discussion",
                str(appended["discussion_id"]),
                expected_revision=int(current.get("revision", 0)),
                updates={"payload": payload},
                history_summary="init discussion intent appended",
                source=f"init:{host}",
            )
            refreshed = _discussion_candidate_from_object(updated)
            appended.update(
                {
                    "status": refreshed.get("status"),
                    "message_count": refreshed.get("message_count"),
                    "open_questions": refreshed.get("open_questions"),
                    "_path": str(store.path("discussion", str(appended["discussion_id"]))),
                }
            )
        return appended
    return create_discussion_placeholder(
        project_root,
        content,
        host=host,
        source=f"init:{host}",
        payload_extra={
            "init_intent": True,
            "raw_intent": content,
            "raw_intents": [content],
            "intent_status": "needs_discussion",
        },
    )


def _normalize_event(raw: Any, index: int, *, status: str) -> dict[str, Any] | None:
    if isinstance(raw, str):
        summary = raw.strip()
        if not summary:
            return None
        return {
            "event_id": f"event-{index + 1}",
            "event_type": "context",
            "status": status,
            "source_summary": summary,
            "normalized_summary": summary,
            "evidence_anchor": {},
            "affects": [],
        }
    if not isinstance(raw, dict):
        return None
    event_type = str(raw.get("event_type") or raw.get("type") or "context").strip()
    if event_type not in SEMANTIC_EVENT_TYPES:
        event_type = "context"
    source_summary = _normalize_string(raw.get("source_summary") or raw.get("summary") or raw.get("text"))
    normalized_summary = _normalize_string(raw.get("normalized_summary") or source_summary)
    if not source_summary and not normalized_summary:
        return None
    evidence = raw.get("evidence_anchor")
    if not isinstance(evidence, dict):
        evidence = {}
    affects = _normalize_string_list(raw.get("affects"))
    return {
        "event_id": _normalize_string(raw.get("event_id")) or f"event-{index + 1}",
        "event_type": event_type,
        "status": status,
        "source_summary": source_summary or normalized_summary,
        "normalized_summary": normalized_summary or source_summary,
        "evidence_anchor": evidence,
        "affects": affects,
    }


def _normalize_events(value: Any, *, status: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        row = _normalize_event(item, index, status=status)
        if row:
            rows.append(row)
    return rows


def normalize_authority_context(
    capsule: dict[str, Any],
    *,
    discussion_id: str | None = None,
    decision_ids: list[str] | None = None,
    status: str = "closed",
) -> dict[str, Any]:
    """Normalize user/agent discussion closure into runtime authority context."""

    source = capsule.get("authority_context") if isinstance(capsule.get("authority_context"), dict) else capsule
    completeness = source.get("completeness") if isinstance(source.get("completeness"), dict) else {}
    open_questions = _normalize_string_list(source.get("open_questions"))
    if not open_questions:
        open_questions = _normalize_string_list(source.get("unresolved_gaps"))
    events = _normalize_events(
        source.get("semantic_events") or source.get("authority_events"),
        status=status,
    )
    resolved_decision_ids = decision_ids or _normalize_string_list(source.get("source_decision_ids"))
    is_closed = bool(completeness.get("is_closed")) if "is_closed" in completeness else status == "closed"
    if open_questions:
        is_closed = False
    return {
        "schema_version": 1,
        "source_discussion_id": discussion_id or _normalize_string(source.get("source_discussion_id")),
        "source_decision_ids": resolved_decision_ids,
        "semantic_events": events,
        "goal": source.get("goal", {}),
        "non_goals": source.get("non_goals", []),
        "constraints": source.get("constraints", []),
        "accepted_decisions": source.get("accepted_decisions", []),
        "rejected_options": source.get("rejected_options", []),
        "assumptions": source.get("assumptions", []),
        "acceptance": source.get("acceptance", {}),
        "context_evidence": source.get("context_evidence", []),
        "risks": source.get("risks", []),
        "run_instructions": source.get("run_instructions", []),
        "open_questions": open_questions,
        "language": source.get("language", {}),
        "completeness": {
            "is_closed": is_closed,
            "unresolved_count": len(open_questions),
            "blocking_reasons": _normalize_string_list(completeness.get("blocking_reasons")),
        },
    }


def _discussion_payload(current: dict[str, Any]) -> dict[str, Any]:
    payload = current.get("payload") if isinstance(current.get("payload"), dict) else {}
    return dict(payload)


def checkpoint_discussion_authority(
    project_root: Path,
    *,
    discussion_id: str,
    capsule: dict[str, Any],
) -> dict[str, Any]:
    store = Store(project_root)
    current = store.read("discussion", discussion_id)
    if not current:
        raise FileNotFoundError(f"discussion:{discussion_id} not found")
    payload = _discussion_payload(current)
    context = normalize_authority_context(capsule, discussion_id=discussion_id, status="draft")
    checkpoints = payload.get("draft_checkpoints") if isinstance(payload.get("draft_checkpoints"), list) else []
    checkpoint = {
        "checkpoint_id": _stable_id("CHK", discussion_id),
        "created_at": utc_now(),
        "authority_context": context,
    }
    payload["draft_checkpoints"] = [*checkpoints, checkpoint]
    payload["authority_events"] = context["semantic_events"]
    payload["open_questions"] = context["open_questions"]
    updated = store.update(
        "discussion",
        discussion_id,
        expected_revision=int(current.get("revision", 0)),
        updates={
            "status": "inquiring",
            "summary": str(current.get("summary") or current.get("title") or discussion_id),
            "payload": payload,
        },
        history_summary="discussion authority checkpointed",
        source="discuss",
    )
    return {"discussion": updated, "checkpoint": checkpoint}


def _decision_payloads(capsule: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = capsule.get("decisions")
    if not isinstance(decisions, list):
        decisions = capsule.get("accepted_decisions")
    if not isinstance(decisions, list):
        return []
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(decisions):
        if isinstance(item, str):
            rows.append(
                {
                    "decision_id": _stable_id("DEC", item),
                    "question": item,
                    "summary": item,
                    "status": "frozen",
                    "selected_values": {"value": item},
                    "unresolved_gaps": [],
                }
            )
        elif isinstance(item, dict):
            row = dict(item)
            row.setdefault("decision_id", _stable_id("DEC", str(row.get("question") or row.get("summary") or index)))
            row.setdefault("question", row.get("summary") or row["decision_id"])
            row.setdefault("status", "frozen")
            row.setdefault("unresolved_gaps", [])
            rows.append(row)
    return rows


def _build_work_payload(capsule: dict[str, Any], authority_context: dict[str, Any], decision_ids: list[str]) -> dict[str, Any] | None:
    work = capsule.get("work_item") if isinstance(capsule.get("work_item"), dict) else {}
    if not work:
        return None
    payload = dict(work)
    payload["decisions"] = decision_ids or payload.get("decisions") or authority_context.get("source_decision_ids") or []
    payload["authority_context"] = authority_context
    payload.setdefault("missing_questions", authority_context.get("open_questions", []))
    if authority_context.get("open_questions"):
        payload["status"] = "blocked"
    return payload


def _is_init_discussion(obj: dict[str, Any]) -> bool:
    return str(obj.get("source") or "").startswith("init:")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def _normalize_project_patch(value: Any, *, init_discussion: bool) -> tuple[dict[str, Any], list[str]]:
    if value in (None, {}, ""):
        return {}, []
    errors: list[str] = []
    if not init_discussion:
        return {}, ["project_patch is only allowed when closing an init discussion"]
    if not isinstance(value, dict):
        return {}, ["project_patch must be an object"]
    unknown = sorted(set(value) - set(PROJECT_PATCH_FIELDS))
    if unknown:
        errors.append("project_patch has unknown fields: " + ", ".join(unknown))
    patch: dict[str, Any] = {}
    for field in ("name", "description"):
        if field not in value:
            continue
        raw = value.get(field)
        if not isinstance(raw, str):
            errors.append(f"project_patch.{field} must be a string")
        elif raw.strip():
            patch[field] = raw.strip()
    if "directions" in value:
        raw_directions = value.get("directions")
        if not isinstance(raw_directions, list):
            errors.append("project_patch.directions must be a list")
        else:
            directions: list[Any] = []
            for index, item in enumerate(raw_directions):
                if isinstance(item, str) and item.strip():
                    directions.append(item.strip())
                elif isinstance(item, dict):
                    direction_id = item.get("id")
                    if not isinstance(direction_id, str) or not direction_id.strip():
                        errors.append(f"project_patch.directions[{index}].id is required")
                    else:
                        directions.append(dict(item))
                else:
                    errors.append(f"project_patch.directions[{index}] must be a string or object")
            if directions:
                patch["directions"] = directions
    return patch, errors


def _apply_project_patch(project_root: Path, patch: dict[str, Any]) -> dict[str, Any] | None:
    if not patch:
        return None
    store = Store(project_root)
    current = store.read("project", "project")
    if not current:
        raise FileNotFoundError("project:project not found")
    payload = current.get("payload") if isinstance(current.get("payload"), dict) else {}
    next_payload = dict(payload)
    project = dict(next_payload.get("project") if isinstance(next_payload.get("project"), dict) else {})
    project.update(patch)
    next_payload["project"] = project
    updated = store.update(
        "project",
        "project",
        expected_revision=int(current.get("revision", 0)),
        updates={
            "title": str(project.get("name") or current.get("title") or "project"),
            "summary": str(project.get("description") or current.get("summary") or ""),
            "payload": next_payload,
        },
        history_summary="init discussion project patch applied",
        source="init-discussion",
    )
    docs_path = docs_root(project_root) / "project.json"
    docs_payload = _read_json(docs_path)
    if docs_payload:
        docs_project = dict(docs_payload.get("project") if isinstance(docs_payload.get("project"), dict) else {})
        docs_project.update(patch)
        docs_payload["project"] = docs_project
        _write_json_atomic(docs_path, docs_payload)
    return updated


def _decision_ids_from_payloads(decisions: list[dict[str, Any]]) -> list[str]:
    rows: list[str] = []
    for item in decisions:
        decision_id = item.get("decision_id") or item.get("object_id")
        if isinstance(decision_id, str) and decision_id.strip():
            rows.append(decision_id.strip())
    return rows


def _normalize_work_graph(
    capsule: dict[str, Any],
    *,
    authority_context: dict[str, Any],
    decision_ids: list[str],
) -> tuple[dict[str, Any] | None, list[str]]:
    graph = capsule.get("work_graph")
    if graph in (None, {}, ""):
        return None, []
    errors: list[str] = []
    if not isinstance(graph, dict):
        return None, ["work_graph must be an object"]
    unknown_graph_fields = sorted(set(graph) - {"nodes", "edges"})
    if unknown_graph_fields:
        errors.append("work_graph has unknown fields: " + ", ".join(unknown_graph_fields))
    raw_nodes = graph.get("nodes")
    if not isinstance(raw_nodes, dict) or not raw_nodes:
        errors.append("work_graph.nodes must be a non-empty object keyed by explicit work_id")
        raw_nodes = {}
    node_ids = [str(key).strip() for key in raw_nodes]
    if len(node_ids) != len(set(node_ids)):
        errors.append("work_graph.nodes contains duplicate or blank work_id keys")
    if any(not work_id for work_id in node_ids):
        errors.append("work_graph.nodes contains blank work_id")

    nodes: dict[str, dict[str, Any]] = {}
    for work_id, raw_node in raw_nodes.items():
        node_id = str(work_id).strip()
        if not isinstance(raw_node, dict):
            errors.append(f"work_graph.nodes.{node_id or '<blank>'} must be an object")
            continue
        unknown_node_fields = sorted(set(raw_node) - set(WORK_GRAPH_NODE_FIELDS))
        if unknown_node_fields:
            errors.append(f"work_graph.nodes.{node_id} has unknown fields: " + ", ".join(unknown_node_fields))
        node_payload = {
            "work_id": node_id,
            "title": raw_node.get("title") or node_id,
            "goal": raw_node.get("goal") or raw_node.get("title") or node_id,
            "context": raw_node.get("context") if isinstance(raw_node.get("context"), str) else "",
            "constraints": raw_node.get("constraints") if isinstance(raw_node.get("constraints"), list) else [],
            "approach_notes": raw_node.get("approach_notes") if isinstance(raw_node.get("approach_notes"), list) else [],
            "missing_questions": raw_node.get("missing_questions") if isinstance(raw_node.get("missing_questions"), list) else [],
            "decisions": decision_ids,
            "authority_context": authority_context,
        }
        if "acceptance_spec" in raw_node:
            node_payload["acceptance_spec"] = raw_node.get("acceptance_spec")
        try:
            canonical_work_id, status, work_payload = work_item_from_payload(node_payload)
        except SchemaError as exc:
            errors.append(f"work_graph.nodes.{node_id} invalid: {exc}")
            continue
        if canonical_work_id != node_id:
            errors.append(f"work_graph.nodes.{node_id} produced mismatched work_id {canonical_work_id}")
        nodes[node_id] = {
            "work_id": node_id,
            "status": status,
            "input": node_payload,
            "payload": work_payload,
            "depends_on": [],
        }

    raw_edges = graph.get("edges", [])
    if raw_edges in (None, ""):
        raw_edges = []
    if not isinstance(raw_edges, list):
        errors.append("work_graph.edges must be a list")
        raw_edges = []
    dependency_map: dict[str, set[str]] = {work_id: set() for work_id in nodes}
    for index, edge in enumerate(raw_edges):
        if not isinstance(edge, dict):
            errors.append(f"work_graph.edges[{index}] must be an object")
            continue
        unknown_edge_fields = sorted(set(edge) - set(WORK_GRAPH_EDGE_FIELDS))
        if unknown_edge_fields:
            errors.append(f"work_graph.edges[{index}] has unknown fields: " + ", ".join(unknown_edge_fields))
        edge_type = edge.get("type", "hard")
        if edge_type not in (None, "hard"):
            errors.append(f"work_graph.edges[{index}].type must be hard")
        source = str(edge.get("from") or "").strip()
        target = str(edge.get("to") or "").strip()
        if not source or not target:
            errors.append(f"work_graph.edges[{index}] requires from and to")
            continue
        if source not in nodes:
            errors.append(f"work_graph.edges[{index}].from references unknown work_id {source}")
        if target not in nodes:
            errors.append(f"work_graph.edges[{index}].to references unknown work_id {target}")
        if source == target:
            errors.append(f"work_graph.edges[{index}] cannot link a node to itself")
        if source in nodes and target in nodes and source != target:
            dependency_map[target].add(source)

    visiting: set[str] = set()
    visited: set[str] = set()
    ordered: list[str] = []

    def visit(work_id: str) -> None:
        if work_id in visited:
            return
        if work_id in visiting:
            errors.append(f"work_graph dependency cycle includes {work_id}")
            return
        visiting.add(work_id)
        for dep_id in sorted(dependency_map.get(work_id, set())):
            visit(dep_id)
        visiting.remove(work_id)
        visited.add(work_id)
        ordered.append(work_id)

    for work_id in sorted(nodes):
        visit(work_id)
    if errors:
        return None, sorted(set(errors))
    for work_id, dep_ids in dependency_map.items():
        nodes[work_id]["depends_on"] = sorted(dep_ids)
    return {
        "nodes": nodes,
        "edges": [{"from": dep_id, "to": work_id, "type": "hard"} for work_id, dep_ids in sorted(dependency_map.items()) for dep_id in sorted(dep_ids)],
        "write_order": ordered,
    }, []


def _graph_work_ids(graph_plan: dict[str, Any] | None) -> list[str]:
    if not graph_plan:
        return []
    return [str(work_id) for work_id in graph_plan.get("write_order", [])]


def close_discussion_authority(
    project_root: Path,
    *,
    discussion_id: str,
    capsule: dict[str, Any],
) -> dict[str, Any]:
    store = Store(project_root)
    current = store.read("discussion", discussion_id)
    if not current:
        raise FileNotFoundError(f"discussion:{discussion_id} not found")

    init_discussion = _is_init_discussion(current)
    decision_payloads = _decision_payloads(capsule)
    decision_ids = _decision_ids_from_payloads(decision_payloads)
    authority_context = normalize_authority_context(
        capsule,
        discussion_id=discussion_id,
        decision_ids=decision_ids,
        status="closed",
    )
    project_patch, project_patch_errors = _normalize_project_patch(
        capsule.get("project_patch"),
        init_discussion=init_discussion,
    )
    if project_patch and not store.read("project", "project"):
        project_patch_errors.append("project_patch requires existing project:project object")
    graph_plan, graph_errors = _normalize_work_graph(
        capsule,
        authority_context=authority_context,
        decision_ids=decision_ids,
    )
    work_payload = None
    extra_errors: list[str] = []
    has_graph = capsule.get("work_graph") not in (None, {}, "")
    has_work_item = isinstance(capsule.get("work_item"), dict) and bool(capsule.get("work_item"))
    if has_graph and has_work_item:
        extra_errors.append("authority capsule must use either work_graph or work_item, not both")
    elif not has_graph:
        work_payload = _build_work_payload(capsule, authority_context, decision_ids)
    if not work_payload and not graph_plan and not project_patch and not project_patch_errors:
        authority_context["open_questions"] = [
            *authority_context.get("open_questions", []),
            "closed authority requires work_item, work_graph, or init project_patch payload",
        ]
        authority_context["completeness"]["is_closed"] = False
        authority_context["completeness"]["unresolved_count"] = len(authority_context["open_questions"])
    missing_work_id = False
    if work_payload and not str(work_payload.get("work_id") or work_payload.get("object_id") or "").strip():
        missing_work_id = True
        authority_context["open_questions"] = [
            *authority_context.get("open_questions", []),
            "closed authority work_item requires stable work_id",
        ]
        authority_context["completeness"]["is_closed"] = False
        authority_context["completeness"]["unresolved_count"] = len(authority_context["open_questions"])
    ready_errors = work_item_input_ready_errors(work_payload) if work_payload and not missing_work_id else []
    if missing_work_id:
        ready_errors = ["closed authority work_item requires stable work_id"]
    all_compile_errors = [*graph_errors, *project_patch_errors, *extra_errors]

    payload = _discussion_payload(current)
    payload["closure"] = authority_context
    payload["authority_events"] = authority_context["semantic_events"]
    payload["open_questions"] = authority_context["open_questions"]
    payload["linked_decision_ids"] = decision_ids
    if graph_plan:
        payload["linked_work_ids"] = _graph_work_ids(graph_plan)
    if project_patch:
        payload["project_patch"] = project_patch

    if authority_context["open_questions"] or not authority_context["completeness"]["is_closed"] or ready_errors or all_compile_errors:
        diagnostics = close_needs_input_diagnostics(
            authority_context=authority_context,
            work_payload=work_payload,
            ready_errors=ready_errors,
            extra_missing_items=(["work_graph"] if graph_errors else [])
            + (["project_patch"] if project_patch_errors else [])
            + (["authority_shape"] if extra_errors else []),
            extra_ready_errors=all_compile_errors,
        )
        if all_compile_errors:
            updated = current
        else:
            payload["close_needs_input"] = diagnostics
            updated = store.update(
                "discussion",
                discussion_id,
                expected_revision=int(current.get("revision", 0)),
                updates={"status": "inquiring", "payload": payload},
                history_summary="discussion authority close needs input",
                source="discuss",
            )
        return {
            "status": "needs_input",
            "discussion": updated,
            "authority_context": authority_context,
            "decisions": [],
            "work_item": None,
            "work_items": [],
            "project": None,
            "diagnostics": diagnostics,
        }

    target_work_ids: list[str] = []
    if work_payload:
        target_work_ids.append(str(work_payload.get("work_id") or work_payload.get("object_id") or ""))
    target_work_ids.extend(_graph_work_ids(graph_plan))
    locked = active_work_ids(project_root)
    for work_id in target_work_ids:
        if work_id and work_id in locked:
            raise ActiveExecutionLock(f"work_item:{work_id} is locked by active execution")

    decision_rows = [upsert_decision(project_root, payload) for payload in decision_payloads]
    decision_ids = [str(item.get("decision_id") or item.get("object_id")) for item in decision_rows if item.get("decision_id") or item.get("object_id")]
    authority_context["source_decision_ids"] = decision_ids

    work_items: list[dict[str, Any]] = []
    if graph_plan:
        nodes = graph_plan.get("nodes") if isinstance(graph_plan.get("nodes"), dict) else {}
        for work_id in graph_plan.get("write_order", []):
            node = nodes.get(work_id) if isinstance(nodes.get(work_id), dict) else {}
            node_input = dict(node.get("input") if isinstance(node.get("input"), dict) else {})
            node_input["decisions"] = decision_ids
            node_input["authority_context"] = authority_context
            node_input["depends_on"] = list(node.get("depends_on") if isinstance(node.get("depends_on"), list) else [])
            node_input["source_kind"] = "discuss"
            work_items.append(upsert_work_item(project_root, node_input))
    elif work_payload:
        work_payload["decisions"] = decision_ids or work_payload.get("decisions") or []
        work_payload["authority_context"] = authority_context
        work_items.append(upsert_work_item(project_root, work_payload))

    project_obj = _apply_project_patch(project_root, project_patch)
    linked_work_ids = [str(item.get("work_id") or item.get("object_id")) for item in work_items if item.get("work_id") or item.get("object_id")]
    payload["linked_work_ids"] = linked_work_ids
    payload["linked_decision_ids"] = decision_ids
    payload["closure"] = authority_context
    links = [{"type": "decided_by", "target": f"decision:{decision_id}"} for decision_id in decision_ids if store.read("decision", decision_id)]
    updated = store.update(
        "discussion",
        discussion_id,
        expected_revision=int(current.get("revision", 0)),
        updates={
            "status": "closed",
            "summary": str(authority_context.get("goal") or current.get("summary") or current.get("title") or discussion_id),
            "links": links,
            "payload": payload,
        },
        history_summary="discussion authority closed",
        source="discuss",
    )
    compile_task_authority(project_root)
    return {
        "status": "ok",
        "discussion": updated,
        "authority_context": authority_context,
        "decisions": decision_rows,
        "work_item": work_items[0] if work_items else None,
        "work_items": work_items,
        "project": project_obj,
    }


def load_authority_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("authority JSON must be an object")
    return data
