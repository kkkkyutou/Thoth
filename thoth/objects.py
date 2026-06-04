"""Canonical Thoth object graph store.

This module is the only writer for durable `.thoth/objects` authority files.
Command handlers, run services, tests, and read models should call `Store`
instead of writing object JSON directly.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1

OBJECT_KINDS = {
    "project",
    "discussion",
    "decision",
    "work_item",
    "controller",
    "experiment",
    "run",
    "phase_result",
    "artifact",
    "doc_view",
}

LINK_TYPES = {
    "primary_parent",
    "depends_on",
    "blocks",
    "decided_by",
    "spawned_by",
    "produced_by",
    "evidence_for",
    "supersedes",
}

ACTIVE_EXECUTION_STATUSES = {"queued", "running", "paused", "waiting_input", "stopping"}
TERMINAL_EXECUTION_STATUSES = {"completed", "failed", "stopped", "validated", "budget_exhausted"}

DISCUSSION_STATUSES = {"inquiring", "closed", "blocked_by_active_execution"}
DECISION_STATUSES = {"proposed", "accepted", "superseded"}
WORK_ITEM_STATUSES = {"draft", "blocked", "ready", "active", "validated", "failed", "abandoned"}
CONTROLLER_STATUSES = ACTIVE_EXECUTION_STATUSES | TERMINAL_EXECUTION_STATUSES
RUN_STATUSES = ACTIVE_EXECUTION_STATUSES | TERMINAL_EXECUTION_STATUSES
PHASE_RESULT_STATUSES = {"pending", "completed", "failed"}
ARTIFACT_STATUSES = {"available", "missing", "superseded"}
DOC_VIEW_STATUSES = {"generated", "stale"}
PROJECT_STATUSES = {"active", "archived"}
EXPERIMENT_STATUSES = {"planned", "running", "paused", "completed", "failed", "archived"}

STATUS_BY_KIND = {
    "project": PROJECT_STATUSES,
    "discussion": DISCUSSION_STATUSES,
    "decision": DECISION_STATUSES,
    "work_item": WORK_ITEM_STATUSES,
    "controller": CONTROLLER_STATUSES,
    "experiment": EXPERIMENT_STATUSES,
    "run": RUN_STATUSES,
    "phase_result": PHASE_RESULT_STATUSES,
    "artifact": ARTIFACT_STATUSES,
    "doc_view": DOC_VIEW_STATUSES,
}

ACCEPTANCE_KINDS = {"mixed", "script", "prose", "io", "metric"}
METRIC_DIRECTIONS = {"gte", "lte", "gt", "lt", "eq"}

REQUIRED_WORK_PAYLOAD_FIELDS = ("goal", "acceptance_spec")

WORK_PAYLOAD_FIELDS = {
    "goal",
    "context",
    "constraints",
    "acceptance_spec",
    "approach_notes",
    "scheduling",
    "run_limits",
    "missing_questions",
}

PUBLIC_WORK_INPUT_FIELDS = WORK_PAYLOAD_FIELDS | {
    "work_id",
    "object_id",
    "title",
    "status",
    "decisions",
    "depends_on",
    "source_kind",
    "authority_context",
}

LEGACY_WORK_PAYLOAD_FIELDS = {
    "work_kind",
    "runnable",
    "module",
    "direction",
    "summary",
    "execution_plan",
    "eval_contract",
    "runtime_policy",
    "validate_output_schema",
    "failure_classes",
    "review_binding",
    "review_expectation",
    "hidden",
    "hidden_reason",
    "superseded_by",
}


def default_authority_context(payload: dict[str, Any], *, decision_ids: list[str] | None = None) -> dict[str, Any]:
    """Build a closed, compact authority context for direct work-item payloads."""

    decisions = decision_ids if decision_ids is not None else _normalize_string_list(payload.get("decisions"))
    goal = payload.get("goal") or ""
    constraints = payload.get("constraints") if isinstance(payload.get("constraints"), list) else []
    acceptance = payload.get("acceptance_spec") if isinstance(payload.get("acceptance_spec"), dict) else {}
    approach_notes = payload.get("approach_notes") if isinstance(payload.get("approach_notes"), list) else []
    return {
        "schema_version": 1,
        "source_discussion_id": "",
        "source_decision_ids": decisions,
        "semantic_events": [],
        "goal": {"source_summary": goal, "normalized_summary": goal},
        "non_goals": [],
        "constraints": constraints,
        "accepted_decisions": decisions,
        "rejected_options": [],
        "assumptions": [],
        "acceptance": acceptance,
        "context_evidence": [],
        "risks": [],
        "run_instructions": approach_notes,
        "open_questions": [],
        "language": {"source": "unspecified", "runtime": "normalized"},
        "completeness": {"is_closed": True, "unresolved_count": 0, "blocking_reasons": []},
    }


def normalize_scheduling(value: Any) -> dict[str, Any]:
    scheduling = value if isinstance(value, dict) else {}
    order = scheduling.get("order")
    if order is not None and not isinstance(order, int):
        order = None
    return {"order": order}


def normalize_run_limits(value: Any) -> dict[str, Any]:
    limits = value if isinstance(value, dict) else {}
    normalized: dict[str, Any] = {}
    for key in ("max_iterations", "max_runtime_seconds"):
        raw = limits.get(key)
        if isinstance(raw, int) and raw > 0:
            normalized[key] = raw
    phase_timeout = limits.get("phase_timeout_seconds")
    if isinstance(phase_timeout, dict):
        rows: dict[str, int] = {}
        for phase, raw in phase_timeout.items():
            if isinstance(phase, str) and isinstance(raw, int) and raw > 0:
                rows[phase] = raw
        if rows:
            normalized["phase_timeout_seconds"] = rows
    return normalized


class StoreError(RuntimeError):
    """Base class for canonical store failures."""


class SchemaError(StoreError):
    """Raised when an object violates the canonical schema."""


class RevisionConflict(StoreError):
    """Raised when optimistic revision checks fail."""


class ActiveExecutionLock(StoreError):
    """Raised when a mutation targets active execution-owned work."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "item"


def objects_root(project_root: Path) -> Path:
    return project_root / ".thoth" / "objects"


def docs_root(project_root: Path) -> Path:
    return project_root / ".thoth" / "docs"


def object_path(project_root: Path, kind: str, object_id: str) -> Path:
    return objects_root(project_root) / kind / f"{object_id}.json"


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def _normalize_links(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    links: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        link_type = item.get("type")
        target = item.get("target")
        if isinstance(link_type, str) and isinstance(target, str) and link_type in LINK_TYPES and target.strip():
            links.append({"type": link_type, "target": target.strip()})
    return links


def _normalize_history(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    history: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            history.append(dict(item))
    return history


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _active_status(value: Any) -> bool:
    return isinstance(value, str) and value in ACTIVE_EXECUTION_STATUSES


def _object_ref(kind: str, object_id: str) -> str:
    return f"{kind}:{object_id}"


def parse_object_ref(value: str) -> tuple[str, str] | None:
    if ":" not in value:
        return None
    kind, object_id = value.split(":", 1)
    if kind not in OBJECT_KINDS or not object_id:
        return None
    return kind, object_id


def active_work_ids(project_root: Path) -> set[str]:
    locked: set[str] = set()
    store = Store(project_root)
    for kind in ("run", "controller"):
        for item in store.list(kind):
            if not _active_status(item.get("status")):
                continue
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            work_id = payload.get("work_id")
            if isinstance(work_id, str) and work_id:
                locked.add(work_id)
    return locked


def _normalize_metric(value: Any) -> dict[str, Any]:
    metric = value if isinstance(value, dict) else {}
    name = metric.get("name")
    direction = str(metric.get("direction") or "gte").strip().lower()
    threshold = metric.get("threshold")
    return {
        "name": name.strip() if isinstance(name, str) else "",
        "direction": direction if direction in METRIC_DIRECTIONS else direction,
        "threshold": threshold,
    }


def normalize_acceptance_spec(value: Any) -> dict[str, Any]:
    spec = value if isinstance(value, dict) else {}
    kind = str(spec.get("kind") or "mixed").strip().lower()
    if kind not in ACCEPTANCE_KINDS:
        kind = "mixed"
    description = spec.get("description")
    if not isinstance(description, str) or not description.strip():
        description = spec.get("summary") if isinstance(spec.get("summary"), str) else ""
    normalized: dict[str, Any] = {
        "kind": kind,
        "description": description.strip() if isinstance(description, str) else "",
        "metric": _normalize_metric(spec.get("metric")),
    }
    for field in ("reference_command", "reference_artifacts", "io_examples"):
        value = spec.get(field)
        if value not in (None, "", [], {}):
            normalized[field] = value
    return normalized


def acceptance_spec_errors(value: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return ["acceptance_spec must be an object"]
    unknown = sorted(set(value) - {"kind", "description", "metric", "reference_command", "reference_artifacts", "io_examples"})
    if unknown:
        errors.append("acceptance_spec has unknown fields: " + ", ".join(unknown))
    kind = value.get("kind")
    if kind not in ACCEPTANCE_KINDS:
        errors.append("acceptance_spec.kind must be one of mixed, script, prose, io, metric")
    description = value.get("description")
    if not isinstance(description, str) or not description.strip():
        errors.append("acceptance_spec.description is required")
    metric = value.get("metric")
    if not isinstance(metric, dict):
        errors.append("acceptance_spec.metric must be an object")
    else:
        name = metric.get("name")
        direction = metric.get("direction")
        if not isinstance(name, str) or not name.strip():
            errors.append("acceptance_spec.metric.name is required")
        if direction not in METRIC_DIRECTIONS:
            errors.append("acceptance_spec.metric.direction must be one of gte, lte, gt, lt, eq")
        if metric.get("threshold") in (None, "", []):
            errors.append("acceptance_spec.metric.threshold is required")
    return errors


def _acceptance_spec_from_legacy(payload: dict[str, Any], *, title: str = "") -> dict[str, Any]:
    eval_contract = payload.get("eval_contract") if isinstance(payload.get("eval_contract"), dict) else {}
    entrypoint = eval_contract.get("entrypoint") if isinstance(eval_contract.get("entrypoint"), dict) else {}
    command = entrypoint.get("command") if isinstance(entrypoint.get("command"), str) else ""
    metric = eval_contract.get("primary_metric") if isinstance(eval_contract.get("primary_metric"), dict) else {}
    description = command or str(payload.get("goal") or title or "Acceptance must be materialized by execute.")
    spec: dict[str, Any] = {
        "kind": "script" if command else "mixed",
        "description": description,
        "metric": _normalize_metric(metric),
    }
    if command:
        spec["reference_command"] = command
    return normalize_acceptance_spec(spec)


def work_item_ready_errors(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    unknown = sorted(set(payload) - WORK_PAYLOAD_FIELDS)
    if unknown:
        errors.append("work_item payload has unknown fields: " + ", ".join(unknown))
    missing_questions = payload.get("missing_questions")
    if missing_questions is None:
        missing_questions = []
    if not isinstance(missing_questions, list):
        errors.append("missing_questions must be a list")
    elif any(isinstance(item, str) and item.strip() for item in missing_questions):
        errors.append("ready work_item requires missing_questions=[]")
    for field in REQUIRED_WORK_PAYLOAD_FIELDS:
        value = payload.get(field)
        if value in (None, "", [], {}):
            errors.append(f"ready work_item requires {field}")
    constraints = payload.get("constraints")
    if constraints is not None and not isinstance(constraints, list):
        errors.append("constraints must be a list")
    approach_notes = payload.get("approach_notes")
    if approach_notes is not None and not isinstance(approach_notes, list):
        errors.append("approach_notes must be a list")
    scheduling = payload.get("scheduling")
    if scheduling is not None:
        normalized = normalize_scheduling(scheduling)
        unknown_scheduling = sorted(set(scheduling) - {"order"}) if isinstance(scheduling, dict) else ["<non-object>"]
        if unknown_scheduling:
            errors.append("scheduling has unknown fields: " + ", ".join(unknown_scheduling))
        if normalized.get("order") != (scheduling.get("order") if isinstance(scheduling, dict) else None):
            errors.append("scheduling.order must be an integer or null")
    run_limits = payload.get("run_limits")
    if run_limits is not None and not isinstance(run_limits, dict):
        errors.append("run_limits must be an object")
    errors.extend(acceptance_spec_errors(payload.get("acceptance_spec")))
    return errors


def validate_object_envelope(project_root: Path, obj: dict[str, Any], *, check_links: bool = True) -> None:
    kind = obj.get("kind")
    if kind not in OBJECT_KINDS:
        raise SchemaError(f"invalid object kind: {kind}")
    object_id = obj.get("object_id")
    if not isinstance(object_id, str) or not object_id.strip():
        raise SchemaError("missing object_id")
    if obj.get("schema_version") != SCHEMA_VERSION:
        raise SchemaError(f"invalid schema_version for {object_id}")
    status = obj.get("status")
    if status not in STATUS_BY_KIND[kind]:
        raise SchemaError(f"invalid {kind} status: {status}")
    if not isinstance(obj.get("revision"), int) or int(obj["revision"]) < 1:
        raise SchemaError("revision must be a positive integer")
    for field in ("title", "summary", "created_at", "updated_at", "source"):
        if not isinstance(obj.get(field), str):
            raise SchemaError(f"{field} must be a string")
    if not isinstance(obj.get("payload"), dict):
        raise SchemaError("payload must be an object")
    if not isinstance(obj.get("history"), list):
        raise SchemaError("history must be a list")
    links = _normalize_links(obj.get("links"))
    if len(links) != len(obj.get("links", [])):
        raise SchemaError("links must be typed object references")
    if check_links:
        for link in links:
            parsed = parse_object_ref(link["target"])
            if parsed is None:
                raise SchemaError(f"invalid link target: {link['target']}")
            target_kind, target_id = parsed
            if target_kind == kind and target_id == object_id:
                raise SchemaError("object cannot link to itself")
            if not object_path(project_root, target_kind, target_id).exists():
                raise SchemaError(f"unknown link target: {link['target']}")
    if kind == "work_item":
        payload = obj["payload"]
        unknown = sorted(set(payload) - WORK_PAYLOAD_FIELDS)
        if unknown:
            raise SchemaError("work_item payload has unknown fields: " + ", ".join(unknown))
        ready_errors = work_item_ready_errors(payload)
        if obj.get("status") == "ready":
            for error in ready_errors:
                raise SchemaError(error)
        if obj.get("status") == "active":
            for error in ready_errors:
                raise SchemaError(error)


@dataclass
class Store:
    project_root: Path

    @property
    def root(self) -> Path:
        return objects_root(self.project_root)

    def ensure_tree(self) -> None:
        for kind in OBJECT_KINDS:
            (self.root / kind).mkdir(parents=True, exist_ok=True)
        docs_root(self.project_root).mkdir(parents=True, exist_ok=True)

    def path(self, kind: str, object_id: str) -> Path:
        if kind not in OBJECT_KINDS:
            raise SchemaError(f"invalid object kind: {kind}")
        return object_path(self.project_root, kind, object_id)

    def read(self, kind: str, object_id: str) -> dict[str, Any]:
        return _read_json(self.path(kind, object_id))

    def list(self, kind: str) -> list[dict[str, Any]]:
        if kind not in OBJECT_KINDS:
            raise SchemaError(f"invalid object kind: {kind}")
        path = self.root / kind
        if not path.is_dir():
            return []
        rows: list[dict[str, Any]] = []
        for candidate in sorted(path.glob("*.json")):
            payload = _read_json(candidate)
            if payload:
                payload.setdefault("_path", str(candidate))
                rows.append(payload)
        return rows

    def create(
        self,
        *,
        kind: str,
        object_id: str,
        status: str,
        title: str,
        summary: str = "",
        source: str = "thoth",
        links: list[dict[str, str]] | None = None,
        payload: dict[str, Any] | None = None,
        history: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        self.ensure_tree()
        if self.path(kind, object_id).exists():
            raise RevisionConflict(f"{kind}:{object_id} already exists")
        now = utc_now()
        obj = {
            "schema_version": SCHEMA_VERSION,
            "object_id": object_id,
            "kind": kind,
            "status": status,
            "title": title,
            "summary": summary,
            "revision": 1,
            "created_at": now,
            "updated_at": now,
            "source": source,
            "links": _normalize_links(links or []),
            "payload": payload or {},
            "history": history or [
                {
                    "revision": 1,
                    "at": now,
                    "summary": "object created",
                    "source": source,
                    "changed_fields": ["*"],
                }
            ],
        }
        validate_object_envelope(self.project_root, obj)
        _write_json_atomic(self.path(kind, object_id), obj)
        return obj

    def upsert(
        self,
        *,
        kind: str,
        object_id: str,
        status: str,
        title: str,
        summary: str = "",
        source: str = "thoth",
        links: list[dict[str, str]] | None = None,
        payload: dict[str, Any] | None = None,
        history_summary: str = "object upserted",
    ) -> dict[str, Any]:
        current = self.read(kind, object_id)
        if not current:
            return self.create(
                kind=kind,
                object_id=object_id,
                status=status,
                title=title,
                summary=summary,
                source=source,
                links=links,
                payload=payload,
            )
        return self.update(
            kind,
            object_id,
            expected_revision=int(current.get("revision", 0)),
            updates={
                "status": status,
                "title": title,
                "summary": summary,
                "source": source,
                "links": _normalize_links(links or []),
                "payload": payload or {},
            },
            history_summary=history_summary,
            source=source,
        )

    def update(
        self,
        kind: str,
        object_id: str,
        *,
        expected_revision: int | None = None,
        updates: dict[str, Any],
        history_summary: str,
        source: str = "thoth",
    ) -> dict[str, Any]:
        self.ensure_tree()
        current = self.read(kind, object_id)
        if not current:
            raise FileNotFoundError(f"{kind}:{object_id} not found")
        if expected_revision is not None and int(current.get("revision", 0)) != expected_revision:
            raise RevisionConflict(f"{kind}:{object_id} revision conflict")
        if kind == "work_item" and object_id in active_work_ids(self.project_root):
            raise ActiveExecutionLock(f"work_item:{object_id} is locked by active execution")
        mutable = dict(current)
        changed_fields = sorted(str(key) for key in updates)
        mutable.update(updates)
        mutable["revision"] = int(current.get("revision", 0)) + 1
        mutable["updated_at"] = utc_now()
        mutable["links"] = _normalize_links(mutable.get("links"))
        mutable["history"] = _normalize_history(mutable.get("history"))
        mutable["history"].append(
            {
                "revision": mutable["revision"],
                "at": mutable["updated_at"],
                "summary": history_summary,
                "source": source,
                "changed_fields": changed_fields,
            }
        )
        validate_object_envelope(self.project_root, mutable)
        _write_json_atomic(self.path(kind, object_id), mutable)
        return mutable

    def tombstone(
        self,
        kind: str,
        object_id: str,
        *,
        expected_revision: int | None = None,
        reason: str = "tombstoned",
    ) -> dict[str, Any]:
        terminal_status = {
            "work_item": "abandoned",
            "decision": "superseded",
            "discussion": "blocked_by_active_execution",
            "controller": "stopped",
            "experiment": "archived",
            "run": "stopped",
            "artifact": "superseded",
            "doc_view": "stale",
            "project": "archived",
            "phase_result": "failed",
        }[kind]
        return self.update(
            kind,
            object_id,
            expected_revision=expected_revision,
            updates={"status": terminal_status},
            history_summary=reason,
        )

    def link(self, source_kind: str, source_id: str, *, link_type: str, target_kind: str, target_id: str) -> dict[str, Any]:
        if link_type not in LINK_TYPES:
            raise SchemaError(f"invalid link type: {link_type}")
        current = self.read(source_kind, source_id)
        if not current:
            raise FileNotFoundError(f"{source_kind}:{source_id} not found")
        target_ref = _object_ref(target_kind, target_id)
        if not self.read(target_kind, target_id):
            raise SchemaError(f"unknown link target: {target_ref}")
        links = _normalize_links(current.get("links"))
        next_link = {"type": link_type, "target": target_ref}
        if next_link not in links:
            links.append(next_link)
        return self.update(
            source_kind,
            source_id,
            expected_revision=int(current.get("revision", 0)),
            updates={"links": links},
            history_summary=f"linked {link_type} {target_ref}",
        )

    def unlink(self, source_kind: str, source_id: str, *, link_type: str, target_kind: str, target_id: str) -> dict[str, Any]:
        current = self.read(source_kind, source_id)
        if not current:
            raise FileNotFoundError(f"{source_kind}:{source_id} not found")
        target_ref = _object_ref(target_kind, target_id)
        links = [
            link
            for link in _normalize_links(current.get("links"))
            if not (link["type"] == link_type and link["target"] == target_ref)
        ]
        return self.update(
            source_kind,
            source_id,
            expected_revision=int(current.get("revision", 0)),
            updates={"links": links},
            history_summary=f"unlinked {link_type} {target_ref}",
        )

    def children(self, parent_kind: str, parent_id: str) -> list[dict[str, Any]]:
        target_ref = _object_ref(parent_kind, parent_id)
        rows: list[dict[str, Any]] = []
        for kind in OBJECT_KINDS:
            for item in self.list(kind):
                if any(link.get("type") == "primary_parent" and link.get("target") == target_ref for link in _normalize_links(item.get("links"))):
                    rows.append(item)
        return rows

    def dependencies(self, kind: str, object_id: str) -> list[dict[str, Any]]:
        item = self.read(kind, object_id)
        rows: list[dict[str, Any]] = []
        for link in _normalize_links(item.get("links")):
            if link["type"] != "depends_on":
                continue
            parsed = parse_object_ref(link["target"])
            if parsed is None:
                continue
            target_kind, target_id = parsed
            target = self.read(target_kind, target_id)
            if target:
                rows.append(target)
        return rows

    def evidence(self, kind: str, object_id: str) -> list[dict[str, Any]]:
        target_ref = _object_ref(kind, object_id)
        rows: list[dict[str, Any]] = []
        for artifact in self.list("artifact"):
            if any(link.get("type") == "evidence_for" and link.get("target") == target_ref for link in _normalize_links(artifact.get("links"))):
                rows.append(artifact)
        return rows


def flatten_work_item(obj: dict[str, Any]) -> dict[str, Any]:
    payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
    acceptance_spec = normalize_acceptance_spec(payload.get("acceptance_spec"))
    metric = acceptance_spec.get("metric") if isinstance(acceptance_spec.get("metric"), dict) else {}
    reference_command = acceptance_spec.get("reference_command")
    io_examples = acceptance_spec.get("io_examples") if isinstance(acceptance_spec.get("io_examples"), dict) else {}
    review_binding = io_examples.get("review_binding") if isinstance(io_examples.get("review_binding"), dict) else {}
    review_expectation = io_examples.get("review_expectation") if isinstance(io_examples.get("review_expectation"), dict) else None
    run_limits = normalize_run_limits(payload.get("run_limits"))
    scheduling = normalize_scheduling(payload.get("scheduling"))
    links = _normalize_links(obj.get("links"))
    depends_on: list[dict[str, str]] = []
    decision_ids: list[str] = []
    source_discussion_id = ""
    superseded_by: str | None = None
    for link in links:
        target = link.get("target", "")
        parsed = parse_object_ref(target)
        if link.get("type") == "depends_on":
            if parsed and parsed[0] == "work_item":
                depends_on.append({"work_id": parsed[1], "type": "hard"})
            elif target:
                depends_on.append({"work_id": target.split(":", 1)[-1], "type": "hard"})
        elif link.get("type") == "decided_by" and parsed and parsed[0] == "decision":
            decision_ids.append(parsed[1])
        elif link.get("type") == "primary_parent" and parsed and parsed[0] == "discussion":
            source_discussion_id = parsed[1]
        elif link.get("type") == "supersedes" and parsed and parsed[0] == "work_item":
            # Source object supersedes target. Historical dashboard consumers also
            # understand the old superseded_by field, so expose a read-only hint.
            superseded_by = parsed[1]
    work_id = str(obj.get("object_id") or "")
    authority_context = default_authority_context(
        {
            "goal": payload.get("goal"),
            "constraints": payload.get("constraints", []),
            "acceptance_spec": acceptance_spec,
            "approach_notes": payload.get("approach_notes", []),
        },
        decision_ids=decision_ids,
    )
    if source_discussion_id:
        authority_context["source_discussion_id"] = source_discussion_id
    flattened = {
        "schema_version": obj.get("schema_version"),
        "kind": "work_item",
        "work_id": work_id,
        "id": work_id,
        "title": obj.get("title", work_id),
        "summary": obj.get("summary", ""),
        "status": obj.get("status"),
        "authority_status": obj.get("status"),
        "revision": obj.get("revision"),
        "ready_state": obj.get("status"),
        "runnable": obj.get("status") in {"ready", "active", "failed"},
        "work_kind": "execution",
        "goal_statement": payload.get("goal"),
        "context": payload.get("context"),
        "module": payload.get("context") or "strict",
        "direction": "general",
        "constraints": payload.get("constraints", []),
        "approach_notes": payload.get("approach_notes", []),
        "implementation_recipe": payload.get("approach_notes", []),
        "acceptance_spec": acceptance_spec,
        "eval_entrypoint": {"command": reference_command} if isinstance(reference_command, str) and reference_command.strip() else {},
        "primary_metric": metric,
        "failure_classes": [],
        "validate_output_schema": {},
        "runtime_contract": {"loop": run_limits} if run_limits else {},
        "run_limits": run_limits,
        "scheduling": scheduling,
        "order": scheduling.get("order"),
        "priority": 0,
        "review_binding": review_binding,
        "review_expectation": review_expectation,
        "decision_ids": decision_ids,
        "authority_context": authority_context,
        "hidden": False,
        "hidden_reason": None,
        "superseded_by": superseded_by,
        "depends_on": depends_on,
        "links": links,
        "created_at": obj.get("created_at"),
        "updated_at": obj.get("updated_at"),
        "_path": obj.get("_path"),
    }
    missing = work_item_ready_errors(payload)
    flattened["blocking_reason"] = "; ".join(missing)
    return flattened


LEGACY_WORK_JSON_FIELDS = {
    "contract_id",
    "task_id",
    "work_type",
    "decision_ids",
    "goal_statement",
    "implementation_recipe",
    "eval_entrypoint",
    "primary_metric",
    "failure_classes",
    "validate_output_schema",
    "runtime_contract",
    "blocking_gaps",
}


def work_item_from_payload(payload: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    legacy_fields = sorted(field for field in LEGACY_WORK_JSON_FIELDS if field in payload)
    if legacy_fields or payload.get("status") == "frozen":
        raise SchemaError(
            "work-json must use work_item semantics; legacy contract/task fields are not accepted: "
            + ", ".join(legacy_fields or ["status=frozen"])
        )
    unknown = sorted(set(payload) - PUBLIC_WORK_INPUT_FIELDS)
    if unknown:
        raise SchemaError("work-json has unknown fields: " + ", ".join(unknown))
    work_id = str(payload.get("work_id") or payload.get("object_id") or "").strip()
    if not work_id:
        work_id = f"work-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{slugify(str(payload.get('title') or 'work'))[:24]}"
    title = str(payload.get("title") or work_id)
    status = str(payload.get("status") or "").strip()
    missing_questions = _normalize_string_list(payload.get("missing_questions"))
    work_payload = {
        "goal": payload.get("goal") or title,
        "context": payload.get("context") if isinstance(payload.get("context"), str) else "",
        "constraints": payload.get("constraints") if isinstance(payload.get("constraints"), list) else [],
        "approach_notes": payload.get("approach_notes") if isinstance(payload.get("approach_notes"), list) else [],
        "scheduling": normalize_scheduling(payload.get("scheduling")),
        "missing_questions": missing_questions,
    }
    if "acceptance_spec" in payload:
        work_payload["acceptance_spec"] = normalize_acceptance_spec(payload.get("acceptance_spec"))
    run_limits = normalize_run_limits(payload.get("run_limits"))
    if run_limits:
        work_payload["run_limits"] = run_limits
    ready_errors = work_item_ready_errors(work_payload)
    if status not in WORK_ITEM_STATUSES:
        status = "ready" if not ready_errors else "blocked"
    elif status == "ready" and ready_errors:
        status = "blocked"
    return work_id, status, work_payload


def _dedupe_links(links: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for link in links:
        link_type = link.get("type")
        target = link.get("target")
        if not isinstance(link_type, str) or not isinstance(target, str):
            continue
        key = (link_type, target)
        if key in seen:
            continue
        seen.add(key)
        rows.append({"type": link_type, "target": target})
    return rows


def compact_existing_work_item(project_root: Path, obj: dict[str, Any]) -> dict[str, Any] | None:
    """Return updates that migrate one existing work_item to the compact schema.

    This is intentionally strict for ambiguous data: dependencies with missing
    targets, missing acceptance metrics on ready work, or unknown non-legacy
    payload fields raise SchemaError instead of guessing.
    """

    if obj.get("kind") != "work_item":
        return None
    payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
    links = _normalize_links(obj.get("links"))
    changed_fields: list[str] = []
    compact_payload: dict[str, Any] = {}

    unknown = sorted(set(payload) - (WORK_PAYLOAD_FIELDS | LEGACY_WORK_PAYLOAD_FIELDS | {"decisions", "depends_on", "authority_context"}))
    if unknown:
        raise SchemaError(f"work_item {obj.get('object_id')} has unknown legacy payload fields: {', '.join(unknown)}")

    goal = payload.get("goal") or obj.get("summary") or obj.get("title") or obj.get("object_id") or ""
    compact_payload["goal"] = str(goal)
    context = payload.get("context")
    if not isinstance(context, str) or not context.strip():
        context = payload.get("module") if isinstance(payload.get("module"), str) else ""
    compact_payload["context"] = context
    compact_payload["constraints"] = payload.get("constraints") if isinstance(payload.get("constraints"), list) else []

    if isinstance(payload.get("acceptance_spec"), dict):
        compact_payload["acceptance_spec"] = normalize_acceptance_spec(payload.get("acceptance_spec"))
    elif isinstance(payload.get("eval_contract"), dict):
        compact_payload["acceptance_spec"] = _acceptance_spec_from_legacy(payload, title=str(obj.get("title") or ""))
        changed_fields.append("eval_contract->acceptance_spec")
    else:
        compact_payload["acceptance_spec"] = normalize_acceptance_spec({})

    approach_notes = payload.get("approach_notes") if isinstance(payload.get("approach_notes"), list) else []
    execution_plan = payload.get("execution_plan") if isinstance(payload.get("execution_plan"), list) else []
    compact_payload["approach_notes"] = approach_notes or execution_plan
    if execution_plan and not approach_notes:
        changed_fields.append("execution_plan->approach_notes")

    scheduling = normalize_scheduling(payload.get("scheduling"))
    if scheduling.get("order") is not None:
        compact_payload["scheduling"] = scheduling
    else:
        compact_payload["scheduling"] = {"order": None}
    if isinstance(payload.get("scheduling"), dict) and "priority" in payload["scheduling"]:
        changed_fields.append("dropped scheduling.priority")

    run_limits = normalize_run_limits(payload.get("run_limits"))
    runtime_policy = payload.get("runtime_policy") if isinstance(payload.get("runtime_policy"), dict) else {}
    loop_policy = runtime_policy.get("loop") if isinstance(runtime_policy.get("loop"), dict) else {}
    for old_key, new_key in (("max_iterations", "max_iterations"), ("max_runtime_seconds", "max_runtime_seconds")):
        raw = loop_policy.get(old_key)
        if isinstance(raw, int) and raw > 0:
            run_limits.setdefault(new_key, raw)
    if run_limits:
        compact_payload["run_limits"] = run_limits
        if runtime_policy:
            changed_fields.append("runtime_policy->run_limits")

    missing_questions = _normalize_string_list(payload.get("missing_questions"))
    if missing_questions:
        compact_payload["missing_questions"] = missing_questions
    else:
        compact_payload["missing_questions"] = []

    work_id = str(obj.get("object_id") or "")
    next_links = list(links)
    for dep_id in _normalize_string_list(payload.get("depends_on")):
        if not object_path(project_root, "work_item", dep_id).exists():
            raise SchemaError(f"work_item {work_id} depends_on missing work_item:{dep_id}")
        next_links.append({"type": "depends_on", "target": f"work_item:{dep_id}"})
        changed_fields.append("depends_on->links")
    for decision_id in _normalize_string_list(payload.get("decisions")):
        if object_path(project_root, "decision", decision_id).exists():
            next_links.append({"type": "decided_by", "target": f"decision:{decision_id}"})
            changed_fields.append("decisions->links")
    authority_context = payload.get("authority_context") if isinstance(payload.get("authority_context"), dict) else {}
    source_discussion_id = authority_context.get("source_discussion_id")
    if isinstance(source_discussion_id, str) and source_discussion_id.strip() and object_path(project_root, "discussion", source_discussion_id).exists():
        next_links.append({"type": "primary_parent", "target": f"discussion:{source_discussion_id}"})
        changed_fields.append("authority_context.source_discussion_id->links")
    superseded_by = payload.get("superseded_by")
    if isinstance(superseded_by, str) and superseded_by.strip() and object_path(project_root, "work_item", superseded_by).exists():
        next_links.append({"type": "supersedes", "target": f"work_item:{superseded_by}"})
        changed_fields.append("superseded_by->links")

    next_links = _dedupe_links(next_links)
    legacy_present = sorted(set(payload) & (LEGACY_WORK_PAYLOAD_FIELDS | {"decisions", "depends_on", "authority_context"}))
    if legacy_present:
        changed_fields.extend(f"dropped {field}" for field in legacy_present if field not in {"depends_on", "decisions"})
    if compact_payload == payload and next_links == links:
        return None

    status = str(obj.get("status") or "blocked")
    if status in {"ready", "active"}:
        errors = work_item_ready_errors(compact_payload)
        if errors:
            raise SchemaError(f"work_item {work_id} cannot migrate as {status}: {'; '.join(errors)}")
    return {
        "payload": compact_payload,
        "links": next_links,
        "summary": str(compact_payload.get("goal") or obj.get("summary") or obj.get("title") or work_id),
        "_migration_changed_fields": sorted(set(changed_fields or ["compact payload"])),
    }


def work_item_input_ready_errors(payload: dict[str, Any]) -> list[str]:
    """Return ready-gate diagnostics for a public work-json payload."""

    try:
        _work_id, _status, work_payload = work_item_from_payload(payload)
    except SchemaError as exc:
        return [str(exc)]
    return work_item_ready_errors(work_payload)


def summarize_object_graph(project_root: Path, *, ensure_tree: bool = True) -> dict[str, Any]:
    store = Store(project_root)
    if ensure_tree:
        store.ensure_tree()
    decision_counts = {"proposed": 0, "accepted": 0, "superseded": 0}
    work_counts = {"ready": 0, "blocked": 0, "draft": 0, "active": 0, "validated": 0, "failed": 0, "abandoned": 0, "total": 0}
    problems: list[str] = []
    blocked_work_ids: list[str] = []
    invalid_work_ids: list[str] = []
    for decision in store.list("decision"):
        status = decision.get("status")
        if status in decision_counts:
            decision_counts[status] += 1
    for work in store.list("work_item"):
        status = str(work.get("status") or "blocked")
        if status in work_counts:
            work_counts[status] += 1
        work_counts["total"] += 1
        payload = work.get("payload") if isinstance(work.get("payload"), dict) else {}
        errors = work_item_ready_errors(payload)
        if status in {"blocked", "draft"}:
            blocked_work_ids.append(str(work.get("object_id")))
        if status == "ready" and errors:
            invalid_work_ids.append(str(work.get("object_id")))
            problems.extend(f"work_item {work.get('object_id')}: {error}" for error in errors)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now(),
        "summary": {
            "decision_counts": decision_counts,
            "work_item_counts": work_counts,
            "ready_work_count": work_counts["ready"],
            "blocked_work_count": len(blocked_work_ids),
            "active_work_count": len(active_work_ids(project_root)),
        },
        "blocked_work_ids": sorted(set(blocked_work_ids)),
        "invalid_work_ids": sorted(set(invalid_work_ids)),
        "problems": problems,
    }
