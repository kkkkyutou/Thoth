"""Authority-context resolution for ready executable work items.

The portable authority source of truth remains the work_item object graph, but
older projects may have ready work items that only reference a closed
discussion by id. This module resolves that legacy shape into a closed
authority_context for runtime packets, while recording provenance so the run is
auditable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from pathlib import Path

from thoth.objects import Store, parse_object_ref


DISCUSSION_ID_RE = re.compile(r"\bDISC-[A-Za-z0-9][A-Za-z0-9._:-]*")


@dataclass(frozen=True)
class AuthorityResolution:
    """Resolved authority plus provenance for a strict task packet."""

    authority_context: dict[str, Any]
    source: str
    source_ids: tuple[str, ...]
    synthesized: bool
    warnings: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": "resolved",
            "source": self.source,
            "source_ids": list(self.source_ids),
            "synthesized": self.synthesized,
            "warnings": list(self.warnings),
        }


def _is_closed_context(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    completeness = value.get("completeness") if isinstance(value.get("completeness"), dict) else {}
    open_questions = value.get("open_questions")
    return completeness.get("is_closed") is True and isinstance(open_questions, list) and not any(
        isinstance(item, str) and item.strip() for item in open_questions
    )


def _discussion_closure(store: Store, discussion_id: str) -> dict[str, Any] | None:
    obj = store.read("discussion", discussion_id)
    if not obj or obj.get("status") != "closed":
        return None
    payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
    closure = payload.get("closure")
    if _is_closed_context(closure):
        return dict(closure)
    return None


def _linked_discussion_ids(strict_task: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    links = strict_task.get("links")
    if isinstance(links, list):
        for link in links:
            if not isinstance(link, dict):
                continue
            parsed = parse_object_ref(str(link.get("target") or ""))
            if parsed and parsed[0] == "discussion":
                ids.append(parsed[1])
    return ids


def _legacy_discussion_ids(strict_task: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    decision_ids = strict_task.get("decision_ids")
    if isinstance(decision_ids, list):
        ids.extend(str(item) for item in decision_ids if isinstance(item, str) and item.startswith("DISC-"))
    context = strict_task.get("context")
    if isinstance(context, str):
        ids.extend(match.group(0) for match in DISCUSSION_ID_RE.finditer(context))
    return ids


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        value = value.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _resolution_from_discussions(
    store: Store,
    discussion_ids: list[str],
    *,
    source: str,
) -> AuthorityResolution | None:
    closed: list[tuple[str, dict[str, Any]]] = []
    for discussion_id in _dedupe(discussion_ids):
        closure = _discussion_closure(store, discussion_id)
        if closure is not None:
            closed.append((discussion_id, closure))
    if not closed:
        return None
    if len(closed) > 1:
        ids = ", ".join(item[0] for item in closed)
        raise ValueError(f"ambiguous closed authority discussions for work item: {ids}")
    discussion_id, closure = closed[0]
    return AuthorityResolution(
        authority_context=closure,
        source=source,
        source_ids=(discussion_id,),
        synthesized=True,
        warnings=("authority_context synthesized from closed discussion",),
    )


def _fallback_payload(strict_task: dict[str, Any]) -> dict[str, Any]:
    return {
        "goal": strict_task.get("goal_statement") or strict_task.get("title") or "",
        "constraints": strict_task.get("constraints") if isinstance(strict_task.get("constraints"), list) else [],
        "approach_notes": strict_task.get("approach_notes") if isinstance(strict_task.get("approach_notes"), list) else [],
        "acceptance_spec": strict_task.get("acceptance_spec") if isinstance(strict_task.get("acceptance_spec"), dict) else {},
        "decisions": strict_task.get("decision_ids") if isinstance(strict_task.get("decision_ids"), list) else [],
    }


def _fallback_context(strict_task: dict[str, Any]) -> dict[str, Any]:
    payload = _fallback_payload(strict_task)
    context = {
        "schema_version": 1,
        "source_discussion_id": "",
        "goal": payload.get("goal", ""),
        "open_questions": [],
        "completeness": {"is_closed": True, "unresolved_count": 0, "blocking_reasons": []},
    }
    if payload.get("decisions"):
        context["source_decision_ids"] = payload.get("decisions", [])
    if payload.get("constraints"):
        context["constraints"] = payload.get("constraints", [])
    if payload.get("acceptance_spec"):
        context["acceptance"] = payload.get("acceptance_spec")
    if payload.get("approach_notes"):
        context["run_instructions"] = payload.get("approach_notes", [])
    return context


def resolve_strict_task_authority(
    project_root: Path,
    strict_task: dict[str, Any],
    *,
    allow_work_item_fallback: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return a strict task with closed authority_context plus provenance.

    The resolver is intentionally conservative: linked discussions outrank
    legacy text references, and fallback synthesis from the work payload is used
    only when the caller explicitly allows it.
    """

    task = dict(strict_task)
    existing = task.get("authority_context")
    if _is_closed_context(existing):
        resolution = AuthorityResolution(
            authority_context=dict(existing),
            source="embedded",
            source_ids=tuple(
                str(item)
                for item in (
                    [existing.get("source_discussion_id")]
                    if isinstance(existing, dict) and existing.get("source_discussion_id")
                    else []
                )
            ),
            synthesized=False,
        )
        task["_authority_resolution"] = resolution.as_dict()
        return task, resolution.as_dict()

    store = Store(project_root)
    linked = _resolution_from_discussions(store, _linked_discussion_ids(task), source="linked_discussion")
    if linked:
        task["authority_context"] = linked.authority_context
        task["_authority_resolution"] = linked.as_dict()
        return task, linked.as_dict()

    legacy = _resolution_from_discussions(store, _legacy_discussion_ids(task), source="legacy_discussion_ref")
    if legacy:
        task["authority_context"] = legacy.authority_context
        task["_authority_resolution"] = legacy.as_dict()
        return task, legacy.as_dict()

    if not allow_work_item_fallback:
        raise ValueError("work item has no closed authority_context or unique closed discussion reference")

    fallback = _fallback_context(task)
    resolution = AuthorityResolution(
        authority_context=fallback,
        source="work_item_payload_compat",
        source_ids=tuple(str(item) for item in task.get("decision_ids", []) if isinstance(item, str)),
        synthesized=True,
        warnings=("authority_context synthesized from ready work item payload",),
    )
    task["authority_context"] = fallback
    task["_authority_resolution"] = resolution.as_dict()
    return task, resolution.as_dict()
