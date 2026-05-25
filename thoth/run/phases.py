"""Mechanical phase engine for strict run/loop orchestration."""

from __future__ import annotations

import shutil
import shlex
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from time import time
from typing import Any, Protocol

from thoth.prompt_specs import command_prompt_authority, phase_prompt_authority
from thoth.prompt_validators import PHASE_REQUIRED_FIELDS, validate_phase_output
from thoth.objects import Store

from .io import _read_json, _write_json
from .guidance import append_run_guidance, guidance_context
from .ledger import (
    _append_event,
    _update_run,
    _update_state,
    complete_run,
    fail_run,
    heartbeat_run,
    record_artifact,
)
from .model import RunHandle, utc_now
from .review_context import latest_fresh_review_context

DEFAULT_LOOP_MAX_ITERATIONS = 10
DEFAULT_LOOP_MAX_RUNTIME_SECONDS = 8 * 60 * 60
DEFAULT_LOOP_RETRY_LIMIT = 2
RUN_PHASE_ORDER = ("plan", "execute", "validate", "reflect")
RUN_PHASE_PROGRESS = {
    "plan": 20,
    "execute": 45,
    "validate": 80,
    "reflect": 95,
}
RUN_REFLECT_FEEDBACK_LIMIT = 1


class PhaseDriver(Protocol):
    """Execute one phase and return the produced JSON object."""

    def execute_phase(self, *, handle: RunHandle, phase_packet: dict[str, Any]) -> dict[str, Any]:
        ...


@dataclass(frozen=True)
class PhaseOutcome:
    terminal: bool
    status: str
    summary: str
    next_phase: str | None
    result_payload: dict[str, Any] | None = None
    reason: str | None = None


def default_validate_output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["summary", "passed", "metric_name", "metric_value", "threshold", "checks"],
        "properties": {
            "summary": {"type": "string"},
            "passed": {"type": "boolean"},
            "metric_name": {"type": "string"},
            "metric_value": {},
            "threshold": {},
            "checks": {"type": "array"},
        },
        "additionalProperties": True,
    }


def normalize_runtime_contract(value: Any) -> dict[str, Any]:
    runtime = value if isinstance(value, dict) else {}
    loop = runtime.get("loop") if isinstance(runtime.get("loop"), dict) else {}
    if not loop and any(key in runtime for key in ("max_iterations", "max_runtime_seconds")):
        loop = runtime
    max_iterations = loop.get("max_iterations")
    max_runtime_seconds = loop.get("max_runtime_seconds")
    if not isinstance(max_iterations, int) or max_iterations <= 0:
        max_iterations = DEFAULT_LOOP_MAX_ITERATIONS
    if not isinstance(max_runtime_seconds, int) or max_runtime_seconds <= 0:
        max_runtime_seconds = DEFAULT_LOOP_MAX_RUNTIME_SECONDS
    return {
        "loop": {
            "max_iterations": max_iterations,
            "max_runtime_seconds": max_runtime_seconds,
        }
    }


def normalize_validate_output_schema(value: Any) -> dict[str, Any]:
    schema = value if isinstance(value, dict) else {}
    if not schema:
        return {}
    return schema


def phase_state_path(handle: RunHandle) -> Path:
    return handle.run_dir / "phase_state.json"


def phase_artifact_path(handle: RunHandle, phase: str) -> Path:
    return handle.run_dir / f"{phase}.json"


def load_phase_state(handle: RunHandle) -> dict[str, Any]:
    return _read_json(phase_state_path(handle))


def _write_phase_state(handle: RunHandle, payload: dict[str, Any]) -> dict[str, Any]:
    payload = dict(payload)
    payload["updated_at"] = utc_now()
    _write_json(phase_state_path(handle), payload)
    return payload


def _upsert_loop_controller_object(handle: RunHandle, payload: dict[str, Any]) -> None:
    run = handle.run_json()
    work_id = run.get("work_id")
    store = Store(handle.project_root)
    work_links = [{"type": "spawned_by", "target": f"work_item:{work_id}"}] if isinstance(work_id, str) and work_id and store.read("work_item", work_id) else []
    store.upsert(
        kind="controller",
        object_id=f"controller-{handle.run_id}",
        status=str(handle.state_json().get("status") or "running"),
        title=str(run.get("title") or handle.run_id),
        summary=str(payload.get("goal") or run.get("title") or handle.run_id),
        source="loop",
        links=work_links,
        payload={
            "run_id": handle.run_id,
            "work_id": work_id,
            "work_revision": run.get("work_revision"),
            "controller_type": "loop",
            "phase_state_path": str(phase_state_path(handle)),
            "child_run_ids": payload.get("loop", {}).get("child_run_ids", []),
            "active_child_run_id": payload.get("loop", {}).get("active_child_run_id"),
            "retry_history": payload.get("loop", {}).get("retry_history", []),
            "last_retry_decision": payload.get("loop", {}).get("last_retry_decision", {}),
            "final_outcome": payload.get("loop", {}).get("final_outcome"),
        },
    )


def minimal_task_authority(strict_task: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "work_id": strict_task.get("work_id"),
        "work_revision": strict_task.get("revision"),
        "title": strict_task.get("title"),
        "goal_statement": strict_task.get("goal_statement"),
        "context": strict_task.get("context"),
        "constraints": strict_task.get("constraints", []),
        "approach_notes": strict_task.get("approach_notes", []),
        "acceptance_spec": strict_task.get("acceptance_spec", {}),
        "eval_entrypoint": strict_task.get("eval_entrypoint", {}),
        "primary_metric": strict_task.get("primary_metric", {}),
        "failure_classes": strict_task.get("failure_classes", []),
        "runtime_contract": normalize_runtime_contract(strict_task.get("runtime_contract")),
        "review_binding": strict_task.get("review_binding", {}),
        "authority_context": strict_task.get("authority_context", {}),
    }
    if isinstance(strict_task.get("review_expectation"), dict):
        payload["review_expectation"] = strict_task.get("review_expectation")
    authority_resolution = strict_task.get("_authority_resolution")
    if isinstance(authority_resolution, dict) and authority_resolution.get("source") != "work_item_payload_compat":
        payload["_authority_resolution"] = authority_resolution
    return payload


def initialize_run_phase_state(
    handle: RunHandle,
    *,
    strict_task: dict[str, Any],
    goal: str,
    target: str | None = None,
    prior_reflect: dict[str, Any] | None = None,
    review_context: dict[str, Any] | None = None,
    loop_context: dict[str, Any] | None = None,
    guidance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    phase_state = {
        "schema_version": 1,
        "mode": "run_once",
        "goal": goal,
        "target": target,
        "strict_task": minimal_task_authority(strict_task),
        "current_phase": "plan",
        "phase_statuses": {},
        "artifacts": {},
        "validate_passed": False,
        "final_summary": None,
        "next_hint": None,
        "prior_reflect": prior_reflect or {},
        "review_context": review_context or {},
        "loop_context": loop_context or {},
        "guidance": guidance or {},
        "command_authority": command_prompt_authority("run"),
        "created_at": utc_now(),
    }
    _update_state(handle, status="running", phase="plan", progress_pct=1)
    _append_event(handle, "run phase state initialized", kind="prepare")
    return _write_phase_state(handle, phase_state)


def initialize_loop_controller(
    handle: RunHandle,
    *,
    strict_task: dict[str, Any],
    goal: str,
    target: str | None = None,
    guidance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    runtime_contract = normalize_runtime_contract(strict_task.get("runtime_contract"))
    review_binding = strict_task.get("review_binding") if isinstance(strict_task.get("review_binding"), dict) else {}
    review_target = review_binding.get("target") if isinstance(review_binding.get("target"), str) else None
    controller = {
        "schema_version": 1,
        "mode": "loop_parent",
        "goal": goal,
        "target": target,
        "strict_task": minimal_task_authority(strict_task),
        "guidance": guidance or {},
        "loop": {
            "max_iterations": runtime_contract["loop"]["max_iterations"],
            "max_runtime_seconds": runtime_contract["loop"]["max_runtime_seconds"],
            "started_at_epoch": time(),
            "iterations_attempted": 0,
            "child_run_ids": [],
            "active_child_run_id": None,
            "last_failure_summary": None,
            "last_reflect": {},
            "last_retry_decision": {},
            "retry_history": [],
            "retry_limit": DEFAULT_LOOP_RETRY_LIMIT,
            "budget_exhausted_by": None,
            "final_outcome": None,
            "review_context": latest_fresh_review_context(
                handle.project_root,
                work_id=str(handle.run_json().get("work_id") or "") or None,
                target=review_target,
            ),
        },
        "command_authority": command_prompt_authority("loop"),
        "created_at": utc_now(),
    }
    _update_state(handle, status="running", phase="plan", progress_pct=1)
    _append_event(handle, "loop controller initialized", kind="prepare")
    payload = _write_phase_state(handle, controller)
    _upsert_loop_controller_object(handle, payload)
    return payload


def build_live_packet(handle: RunHandle) -> dict[str, Any]:
    run = handle.run_json()
    controller = load_phase_state(handle)
    packet = {
        "schema_version": 1,
        "protocol": "thoth-runtime/v2",
        "packet_kind": "phase_execution",
        "prepared_at": utc_now(),
        "project_root": str(handle.project_root.resolve()),
        "run_id": handle.run_id,
        "kind": run.get("kind"),
        "command_id": run.get("kind"),
        "work_id": run.get("work_id"),
        "work_revision": run.get("work_revision"),
        "title": run.get("title"),
        "goal": controller.get("goal"),
        "target": controller.get("target"),
        "host": run.get("host"),
        "executor": run.get("executor"),
        "dispatch_mode": run.get("dispatch_mode"),
        "sleep_requested": bool(run.get("sleep_requested")),
        "strict_task": controller.get("strict_task", {}),
        "command_authority": controller.get("command_authority", command_prompt_authority(str(run.get("kind") or "run"))),
        "phase_state": {
            "current_phase": controller.get("current_phase"),
            "phase_statuses": controller.get("phase_statuses", {}),
        },
        "guidance": controller.get("guidance", {}),
        "paths": {
            "run_dir": str(handle.run_dir),
            "state": str(handle.run_dir / "state.json"),
            "events": str(handle.run_dir / "events.jsonl"),
            "result": str(handle.run_dir / "result.json"),
            "phase_state": str(phase_state_path(handle)),
        },
    }
    if controller.get("mode") == "loop_parent":
        packet["loop"] = controller.get("loop", {})
    return packet


def _compact_history_run(handle: RunHandle, run_dir: Path) -> dict[str, Any]:
    state = _read_json(run_dir / "state.json")
    run = _read_json(run_dir / "run.json")
    result = _read_json(run_dir / "result.json")
    artifacts = result.get("result", {}).get("artifacts") if isinstance(result.get("result"), dict) else {}
    row: dict[str, Any] = {
        "run_id": run_dir.name,
        "status": result.get("status") or state.get("status"),
        "summary": result.get("summary"),
        "reason": result.get("reason"),
        "work_revision": run.get("work_revision"),
        "updated_at": state.get("updated_at") or result.get("updated_at") or run.get("updated_at"),
        "artifacts": artifacts if isinstance(artifacts, dict) else {},
    }
    for phase in ("plan", "execute", "validate", "reflect"):
        payload = _read_json(run_dir / f"{phase}.json")
        if payload:
            row[f"{phase}_summary"] = payload.get("summary")
            if phase == "validate":
                row["validate_passed"] = payload.get("passed")
                row["failure_class"] = payload.get("failure_class")
            if phase == "reflect":
                row["corrective_prompt"] = payload.get("corrective_prompt")
    return row


def _history_context_for_work(project_root: Path, work_id: Any, *, limit: int = 5) -> dict[str, Any]:
    if not isinstance(work_id, str) or not work_id.strip():
        return {"runs": []}
    runs_root = project_root / ".thoth" / "runs"
    if not runs_root.is_dir():
        return {"runs": []}
    rows: list[tuple[str, Path]] = []
    for run_dir in runs_root.iterdir():
        if not run_dir.is_dir():
            continue
        run = _read_json(run_dir / "run.json")
        if run.get("work_id") == work_id:
            state = _read_json(run_dir / "state.json")
            rows.append((str(state.get("updated_at") or run.get("updated_at") or ""), run_dir))
    rows.sort(key=lambda item: item[0], reverse=True)
    return {"runs": [_compact_history_run(RunHandle(project_root=project_root, run_id=path.name), path) for _updated, path in rows[:limit]]}


def _history_execute_artifact(project_root: Path, run_id: str) -> Path | None:
    run_dir = project_root / ".thoth" / "runs" / run_id
    phase_state = _read_json(run_dir / "phase_state.json")
    artifacts = phase_state.get("artifacts") if isinstance(phase_state.get("artifacts"), dict) else {}
    candidate = artifacts.get("execute")
    if isinstance(candidate, str) and candidate.strip():
        path = Path(candidate)
        if not path.is_absolute():
            path = project_root / path
        if path.exists():
            return path
    fallback = run_dir / "execute.json"
    return fallback if fallback.exists() else None


def _acceptance_fingerprint(strict_task: dict[str, Any]) -> str:
    payload = {
        "goal": strict_task.get("goal_statement"),
        "constraints": strict_task.get("constraints", []),
        "acceptance_spec": strict_task.get("acceptance_spec", {}),
        "primary_metric": strict_task.get("primary_metric", {}),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _history_reconcile_current_run(handle: RunHandle, controller: dict[str, Any]) -> PhaseOutcome | None:
    run = handle.run_json()
    work_id = run.get("work_id")
    history = _history_context_for_work(handle.project_root, work_id).get("runs", [])
    strict_task = controller.get("strict_task") if isinstance(controller.get("strict_task"), dict) else {}
    for row in history:
        source_run_id = row.get("run_id")
        if not isinstance(source_run_id, str) or source_run_id == handle.run_id:
            continue
        execute_artifact = _history_execute_artifact(handle.project_root, source_run_id)
        if execute_artifact is None:
            continue
        phase_packet = {
            "schema_version": 1,
            "run_id": handle.run_id,
            "work_id": work_id,
            "work_revision": run.get("work_revision"),
            "phase": "validate",
            "strict_task": strict_task,
            "prior_artifacts": {"execute": str(execute_artifact)},
        }
        validate_payload = mechanical_validate_phase_output(handle.project_root, phase_packet)
        if validate_payload.get("passed") is not True:
            continue
        validate_artifact = _write_phase_artifact(handle, "validate", validate_payload)
        payload = {
            "schema_version": 1,
            "source_run_id": source_run_id,
            "source_receipt_ref": str(execute_artifact),
            "acceptance_fingerprint": _acceptance_fingerprint(strict_task),
            "passed": True,
            "check_summary": [
                {"name": check.get("name"), "ok": check.get("ok")}
                for check in validate_payload.get("checks", [])[:8]
                if isinstance(check, dict)
            ],
            "reason": "historical execute receipt satisfies current acceptance contract",
            "created_at": utc_now(),
        }
        path = handle.run_dir / "history-reconcile.json"
        _write_json(path, payload)
        record_artifact(handle.project_root, handle.run_id, path=str(path), label=path.name, artifact_kind="history_reconcile")
        controller.setdefault("artifacts", {})
        controller.setdefault("phase_statuses", {})
        controller["artifacts"]["validate"] = validate_artifact
        controller["artifacts"]["history_reconcile"] = str(path)
        controller["phase_statuses"]["plan"] = "completed"
        controller["phase_statuses"]["execute"] = "skipped_history"
        controller["phase_statuses"]["validate"] = "completed"
        controller["phase_statuses"]["reflect"] = "completed"
        controller["validate_passed"] = True
        controller["final_summary"] = "Closed from historical validation evidence."
        _write_phase_state(handle, controller)
        result_payload = _build_run_result_payload(controller)
        result_payload["history_reconcile"] = payload
        return PhaseOutcome(True, "completed", "Closed from historical validation evidence.", None, result_payload=result_payload)
    _append_event(
        handle,
        "history close requested but no historical receipt passed current validation; continuing execute",
        kind="history",
        level="warning",
    )
    return None


def _phase_input_for_run(handle: RunHandle, controller: dict[str, Any]) -> dict[str, Any]:
    phase = str(controller.get("current_phase") or "plan")
    strict_task = controller.get("strict_task") if isinstance(controller.get("strict_task"), dict) else {}
    packet = {
        "schema_version": 1,
        "run_id": handle.run_id,
        "work_id": handle.run_json().get("work_id"),
        "work_revision": handle.run_json().get("work_revision"),
        "phase": phase,
        "goal": controller.get("goal"),
        "target": controller.get("target"),
        "strict_task": strict_task,
        "history_context": _history_context_for_work(handle.project_root, handle.run_json().get("work_id")) if phase == "plan" else {},
        "prior_artifacts": controller.get("artifacts", {}),
        "prior_reflect": controller.get("prior_reflect", {}),
        "review_context": controller.get("review_context", {}),
        "loop_context": controller.get("loop_context", {}),
        "guidance": {
            "inherited": controller.get("guidance", {}) if isinstance(controller.get("guidance"), dict) else {},
            "current": guidance_context(handle.project_root, handle.run_id),
        },
        "budget": {
            "remaining_exec_attempts": 1,
        },
        "command_authority": controller.get("command_authority", command_prompt_authority("run")),
        "phase_authority": phase_prompt_authority(phase),
        "output_contract": {
            "required_fields": list(PHASE_REQUIRED_FIELDS[phase]),
            "summary_budget_utf8": phase_prompt_authority(phase)["summary_budget_utf8"],
            "validate_output_schema": strict_task.get("validate_output_schema") if phase == "validate" else None,
            "plan_artifact_required": phase == "execute",
        },
    }
    reflect_feedback = controller.get("reflect_feedback")
    if isinstance(reflect_feedback, dict) and reflect_feedback:
        packet["reflect_feedback"] = reflect_feedback
    if phase == "execute":
        packet["required_plan_artifact"] = controller.get("artifacts", {}).get("plan") if isinstance(controller.get("artifacts"), dict) else None
        plan_artifact = packet.get("required_plan_artifact")
        plan_payload = _read_json(Path(plan_artifact)) if isinstance(plan_artifact, str) else {}
        discovery_tasks = plan_payload.get("discovery_tasks") if isinstance(plan_payload.get("discovery_tasks"), list) else []
        packet["discovery_tasks"] = discovery_tasks
    return packet


def _maybe_activate_next_child(handle: RunHandle, controller: dict[str, Any]) -> dict[str, Any]:
    loop = controller.get("loop") if isinstance(controller.get("loop"), dict) else {}
    active_child_id = loop.get("active_child_run_id")
    if isinstance(active_child_id, str) and active_child_id.strip():
        return controller
    if _loop_budget_exhausted(controller):
        return controller
    loop["iterations_attempted"] = int(loop.get("iterations_attempted") or 0) + 1
    iteration_index = int(loop["iterations_attempted"])
    child_handle = create_child_run(
        handle,
        strict_task=controller.get("strict_task", {}),
        goal=str(controller.get("goal") or handle.run_json().get("title") or handle.run_id),
        iteration_index=iteration_index,
        prior_reflect=loop.get("last_reflect") if isinstance(loop.get("last_reflect"), dict) else {},
        review_context=loop.get("review_context") if isinstance(loop.get("review_context"), dict) else {},
        loop_context=_build_loop_context(loop),
        guidance=controller.get("guidance") if isinstance(controller.get("guidance"), dict) else {},
    )
    loop["active_child_run_id"] = child_handle.run_id
    child_ids = loop.get("child_run_ids") if isinstance(loop.get("child_run_ids"), list) else []
    loop["child_run_ids"] = [*child_ids, child_handle.run_id]
    controller["loop"] = loop
    _update_state(handle, phase="plan", progress_pct=max(1, int(handle.state_json().get("progress_pct") or 1)))
    _append_event(
        handle,
        f"loop iteration {iteration_index} started",
        kind="loop",
        payload={"child_run_id": child_handle.run_id, "iteration_index": iteration_index},
    )
    payload = _write_phase_state(handle, controller)
    _upsert_loop_controller_object(handle, payload)
    return payload


def _phase_input_for_loop_parent(handle: RunHandle, controller: dict[str, Any]) -> dict[str, Any]:
    controller = _maybe_activate_next_child(handle, controller)
    loop = controller.get("loop") if isinstance(controller.get("loop"), dict) else {}
    active_child_id = str(loop.get("active_child_run_id") or "").strip()
    if not active_child_id:
        reason = str(loop.get("budget_exhausted_by") or "loop_finished")
        return {
            "schema_version": 1,
            "run_id": handle.run_id,
            "terminal": True,
            "reason": reason,
            "loop": loop,
        }
    child_handle = RunHandle(project_root=handle.project_root, run_id=active_child_id)
    child_controller = load_phase_state(child_handle)
    payload = _phase_input_for_run(child_handle, child_controller)
    payload["parent_run_id"] = handle.run_id
    payload["iteration_index"] = child_handle.run_json().get("iteration_index")
    payload["loop"] = {
        "max_iterations": loop.get("max_iterations"),
        "max_runtime_seconds": loop.get("max_runtime_seconds"),
        "iterations_attempted": loop.get("iterations_attempted"),
    }
    return payload


def next_phase_payload(project_root: Path, run_id: str) -> dict[str, Any]:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    controller = load_phase_state(handle)
    if not controller:
        raise FileNotFoundError(f"Run {run_id} is missing phase_state.json")
    mode = controller.get("mode")
    if mode == "loop_parent":
        return _phase_input_for_loop_parent(handle, controller)
    return _phase_input_for_run(handle, controller)


def _prior_validate_payload(controller: dict[str, Any]) -> dict[str, Any] | None:
    artifacts = controller.get("artifacts") if isinstance(controller.get("artifacts"), dict) else {}
    validate_artifact = artifacts.get("validate")
    if not isinstance(validate_artifact, str) or not validate_artifact:
        return None
    payload = _read_json(Path(validate_artifact))
    return payload if isinstance(payload, dict) and payload else None


def _require_phase_payload(
    phase: str,
    payload: dict[str, Any],
    *,
    validate_schema: dict[str, Any] | None = None,
    prior_validate_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return validate_phase_output(
        phase,
        payload,
        validate_schema=validate_schema,
        prior_validate_payload=prior_validate_payload,
    )


def _write_phase_artifact(handle: RunHandle, phase: str, payload: dict[str, Any]) -> str:
    path = phase_artifact_path(handle, phase)
    _write_json(path, payload)
    record_artifact(handle.project_root, handle.run_id, path=str(path), label=path.name, artifact_kind="phase")
    run = handle.run_json()
    Store(handle.project_root).upsert(
        kind="phase_result",
        object_id=f"{handle.run_id}-{phase}",
        status="completed",
        title=f"{handle.run_id} {phase}",
        summary=str(payload.get("summary") or phase),
        source="run",
        links=[{"type": "produced_by", "target": f"run:{handle.run_id}"}],
        payload={
            "run_id": handle.run_id,
            "work_id": run.get("work_id"),
            "work_revision": run.get("work_revision"),
            "phase": phase,
            "artifact_path": str(path),
            "output": payload,
        },
    )
    return str(path)


def _compact_whitespace(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _command_tokens(value: str) -> list[str]:
    try:
        return shlex.split(value)
    except ValueError:
        return value.split()


def _is_env_assignment(token: str) -> bool:
    if "=" not in token:
        return False
    name, _value = token.split("=", 1)
    if not name:
        return False
    if not (name[0].isalpha() or name[0] == "_"):
        return False
    return all(char.isalnum() or char == "_" for char in name)


def _strip_leading_env_tokens(tokens: list[str]) -> list[str]:
    rows = list(tokens)
    if rows and rows[0] == "env":
        rows = rows[1:]
    index = 0
    while index < len(rows) and _is_env_assignment(rows[index]):
        index += 1
    return rows[index:]


def _is_python_token(token: str) -> bool:
    name = Path(token).name
    return name == "python" or name.startswith("python3")


def _normalize_command_tokens(tokens: list[str]) -> list[str]:
    rows = _strip_leading_env_tokens(tokens)
    if rows and _is_python_token(rows[0]):
        rows = ["python", *rows[1:]]
    return rows


def _pytest_index(tokens: list[str]) -> int | None:
    for index, token in enumerate(tokens):
        name = Path(token).name
        if name == "pytest" or name.startswith("pytest-"):
            return index
        if token == "pytest" and index >= 2 and _is_python_token(tokens[index - 2]) and tokens[index - 1] == "-m":
            return index
    return None


def _pytest_args(tokens: list[str]) -> list[str]:
    index = _pytest_index(tokens)
    return tokens[index + 1 :] if index is not None else []


def _pytest_targets(tokens: list[str]) -> list[str]:
    args = _pytest_args(tokens)
    targets: list[str] = []
    skip_next = False
    value_flags = {"-k", "-m", "--keyword", "--maxfail", "--tb", "--ignore", "--ignore-glob", "--rootdir"}
    for arg in args:
        if skip_next:
            skip_next = False
            continue
        if arg in value_flags:
            skip_next = True
            continue
        if arg.startswith("--") and "=" in arg:
            continue
        if arg.startswith("-"):
            continue
        targets.append(arg)
    return targets


def _pytest_selection_flags(tokens: list[str]) -> set[str]:
    args = _pytest_args(tokens)
    flags: set[str] = set()
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in {"-k", "--keyword"}:
            value = args[index + 1] if index + 1 < len(args) else ""
            flags.add(f"-k={value}")
            index += 2
            continue
        if arg.startswith("-k") and arg != "-k":
            flags.add(arg)
        if arg == "-m":
            value = args[index + 1] if index + 1 < len(args) else ""
            flags.add(f"-m={value}")
            index += 2
            continue
        index += 1
    return flags


def _pytest_target_covers(expected: str, actual: str) -> bool:
    if actual == expected:
        return True
    return expected.startswith(actual + "::")


def _obvious_validator_drift(expected_command: str, actual_command: str) -> str:
    if not expected_command:
        return ""
    if not actual_command:
        return "actual command missing"
    expected_tokens = _normalize_command_tokens(_command_tokens(expected_command))
    actual_tokens = _normalize_command_tokens(_command_tokens(actual_command))
    expected_pytest = _pytest_index(expected_tokens)
    actual_pytest = _pytest_index(actual_tokens)
    if expected_pytest is None or actual_pytest is None:
        return ""
    expected_targets = _pytest_targets(expected_tokens)
    actual_targets = _pytest_targets(actual_tokens)
    for target in expected_targets:
        if not any(_pytest_target_covers(target, actual) for actual in actual_targets):
            return f"expected pytest target not covered: {target}"
    expected_filters = _pytest_selection_flags(expected_tokens)
    actual_filters = _pytest_selection_flags(actual_tokens)
    added_filters = sorted(actual_filters - expected_filters)
    if added_filters:
        return f"actual pytest command adds selection filter: {', '.join(added_filters)}"
    return ""


def _receipt_equivalence_value(receipt: dict[str, Any], key: str) -> Any:
    value = receipt.get(key)
    if value is not None:
        return value
    nested = receipt.get("validation_equivalence")
    if isinstance(nested, dict):
        return nested.get(key)
    return None


def _receipt_equivalence_bool(receipt: dict[str, Any], key: str, default: bool) -> bool:
    value = _receipt_equivalence_value(receipt, key)
    return value if isinstance(value, bool) else default


def _receipt_equivalence_text(receipt: dict[str, Any], key: str) -> str:
    value = _receipt_equivalence_value(receipt, key)
    return str(value or "").strip() if isinstance(value, str) else ""


def _command_relation(expected_command: str, actual_command: str, receipt: dict[str, Any]) -> tuple[str, str]:
    declared = _receipt_equivalence_text(receipt, "command_relation") or _receipt_equivalence_text(receipt, "command_equivalence")
    rationale = _receipt_equivalence_text(receipt, "equivalence_rationale") or _receipt_equivalence_text(receipt, "evidence_rationale")
    if not expected_command:
        return declared or "not_declared", rationale or "no reference command declared"
    if not actual_command:
        return declared or "missing", rationale or "actual command missing from receipt"
    if actual_command == expected_command:
        return declared or "exact", rationale or "actual command exactly matches reference command"
    expected_tokens = _command_tokens(expected_command)
    actual_tokens = _command_tokens(actual_command)
    if _strip_leading_env_tokens(actual_tokens) == expected_tokens:
        return declared or "environment_adjusted", rationale or "actual command adds leading environment assignments"
    if _normalize_command_tokens(actual_tokens) == _normalize_command_tokens(expected_tokens):
        return declared or "interpreter_or_environment_adjusted", rationale or "actual command preserves reference argv after environment/interpreter normalization"
    if expected_command in actual_command:
        return declared or "wrapper_equivalent", rationale or "actual command wraps the reference command"
    if declared and declared not in {"not_equivalent", "changed"}:
        return declared, rationale or "execute receipt declared validator equivalence"
    return declared or "changed", rationale


def _blocking_checks_passed(checks: list[dict[str, Any]]) -> bool:
    for check in checks:
        if check.get("ok") is False and check.get("blocking") is not False:
            return False
    return True


def _primary_metric_name(strict_task: dict[str, Any]) -> str:
    metric = strict_task.get("primary_metric") if isinstance(strict_task.get("primary_metric"), dict) else {}
    if not metric:
        acceptance = strict_task.get("acceptance_spec") if isinstance(strict_task.get("acceptance_spec"), dict) else {}
        metric = acceptance.get("metric") if isinstance(acceptance.get("metric"), dict) else {}
    name = metric.get("name")
    return str(name or "official_validation").strip() or "official_validation"


def _primary_metric_threshold(strict_task: dict[str, Any]) -> Any:
    metric = strict_task.get("primary_metric") if isinstance(strict_task.get("primary_metric"), dict) else {}
    if not metric:
        acceptance = strict_task.get("acceptance_spec") if isinstance(strict_task.get("acceptance_spec"), dict) else {}
        metric = acceptance.get("metric") if isinstance(acceptance.get("metric"), dict) else {}
    return metric.get("threshold", 1)


def _primary_metric_direction(strict_task: dict[str, Any]) -> str:
    metric = strict_task.get("primary_metric") if isinstance(strict_task.get("primary_metric"), dict) else {}
    if not metric:
        acceptance = strict_task.get("acceptance_spec") if isinstance(strict_task.get("acceptance_spec"), dict) else {}
        metric = acceptance.get("metric") if isinstance(acceptance.get("metric"), dict) else {}
    direction = str(metric.get("direction") or "gte").strip().lower()
    aliases = {
        "min": "gte",
        "at_least": "gte",
        ">=": "gte",
        "max": "lte",
        "at_most": "lte",
        "<=": "lte",
        ">": "gt",
        "<": "lt",
        "==": "eq",
        "=": "eq",
    }
    return aliases.get(direction, direction if direction in {"gte", "lte", "gt", "lt", "eq"} else "gte")


def _metric_meets_threshold(value: Any, threshold: Any, *, direction: str) -> bool:
    if isinstance(value, bool):
        value = int(value)
    if isinstance(threshold, bool):
        threshold = int(threshold)
    if isinstance(value, (int, float)) and isinstance(threshold, (int, float)):
        if direction == "lte":
            return float(value) <= float(threshold)
        if direction == "lt":
            return float(value) < float(threshold)
        if direction == "gt":
            return float(value) > float(threshold)
        if direction == "eq":
            return float(value) == float(threshold)
        return float(value) >= float(threshold)
    if direction == "eq":
        return value == threshold
    return bool(value)


def _path_exists_from_receipt(project_root: Path, value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        path = Path(value)
        if not path.is_absolute():
            path = project_root / path
        return path.exists()
    except OSError:
        return False


def _receipt_log_path(project_root: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        path = Path(value)
        if not path.is_absolute():
            path = project_root / path
        return path if path.exists() else None
    except OSError:
        return None


def _write_normalized_receipt_log(
    *,
    handle: RunHandle,
    name: str,
    content: str,
    source_field: str,
    warnings: list[dict[str, Any]],
) -> str:
    log_dir = handle.run_dir / "worker-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"official-validator.{name}.log"
    path.write_text(content, encoding="utf-8")
    warnings.append(
        {
            "field": source_field,
            "reason": "receipt_log_materialized",
            "path": str(path),
        }
    )
    record_artifact(
        handle.project_root,
        handle.run_id,
        path=str(path),
        label=path.name,
        artifact_kind="log",
        metadata={"phase": "validate", "source": "official_validation_receipt", "stream": name},
    )
    return str(path)


_RECEIPT_CANONICAL_FIELDS = (
    "command",
    "reference_command",
    "command_relation",
    "equivalence_rationale",
    "exit_code",
    "passed",
    "metric_name",
    "metric_value",
    "metric_direction",
    "threshold",
    "stdout_log",
    "stdout_log_path",
    "stderr_log",
    "stderr_log_path",
    "cwd",
    "python_executable",
    "env_summary",
    "validation_method",
    "materialized_validator_refs",
)


def _receipt_field_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _warn_receipt_alias(
    warnings: list[dict[str, Any]],
    *,
    source_field: str,
    canonical_field: str,
) -> None:
    warnings.append(
        {
            "field": f"official_validation_receipt.{source_field}",
            "reason": "alias_normalized",
            "canonical_field": canonical_field,
        }
    )


def _copy_receipt_field(
    source: dict[str, Any],
    target: dict[str, Any],
    warnings: list[dict[str, Any]],
    canonical_field: str,
    *aliases: str,
) -> None:
    value = source.get(canonical_field)
    if _receipt_field_present(value):
        target[canonical_field] = value
        return
    for alias in aliases:
        value = source.get(alias)
        if _receipt_field_present(value):
            target[canonical_field] = value
            _warn_receipt_alias(warnings, source_field=alias, canonical_field=canonical_field)
            return


def _normalize_metric_receipt_fields(
    source: dict[str, Any],
    target: dict[str, Any],
    warnings: list[dict[str, Any]],
) -> None:
    metric = source.get("metric")
    metric_obj = metric if isinstance(metric, dict) else {}
    metric_aliases = {
        "metric_name": ("name",),
        "metric_value": ("value",),
        "metric_direction": ("direction",),
        "threshold": ("threshold",),
    }
    for canonical_field, nested_aliases in metric_aliases.items():
        if _receipt_field_present(target.get(canonical_field)):
            continue
        value = source.get(canonical_field)
        if _receipt_field_present(value):
            target[canonical_field] = value
            continue
        for nested_alias in nested_aliases:
            value = metric_obj.get(nested_alias)
            if _receipt_field_present(value):
                target[canonical_field] = value
                _warn_receipt_alias(
                    warnings,
                    source_field=f"metric.{nested_alias}",
                    canonical_field=canonical_field,
                )
                break


def _canonicalize_official_validation_receipt(
    *,
    receipt: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    warnings: list[dict[str, Any]] = []
    canonical: dict[str, Any] = {}
    _copy_receipt_field(receipt, canonical, warnings, "command", "actual_command")
    _copy_receipt_field(receipt, canonical, warnings, "reference_command")
    _copy_receipt_field(receipt, canonical, warnings, "command_relation", "command_equivalence")
    _copy_receipt_field(receipt, canonical, warnings, "equivalence_rationale", "evidence_rationale")
    for field in (
        "exit_code",
        "passed",
        "cwd",
        "python_executable",
        "env_summary",
        "validation_method",
        "materialized_validator_refs",
    ):
        _copy_receipt_field(receipt, canonical, warnings, field)
    _copy_receipt_field(receipt, canonical, warnings, "stdout_log", "stdout")
    _copy_receipt_field(receipt, canonical, warnings, "stdout_log_path")
    _copy_receipt_field(receipt, canonical, warnings, "stderr_log", "stderr")
    _copy_receipt_field(receipt, canonical, warnings, "stderr_log_path")
    _normalize_metric_receipt_fields(receipt, canonical, warnings)
    return canonical, warnings


def _normalize_receipt_logs(
    *,
    handle: RunHandle,
    receipt: dict[str, Any],
    observed_success: bool,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], bool]:
    normalized = dict(receipt)
    warnings: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []

    stdout_path_value = normalized.get("stdout_log_path")
    stdout_inline_value = normalized.get("stdout_log")
    stdout_path = _receipt_log_path(handle.project_root, stdout_path_value)
    if stdout_path is None:
        stdout_path = _receipt_log_path(handle.project_root, stdout_inline_value)
    if stdout_path is None and isinstance(stdout_inline_value, str) and stdout_inline_value:
        stdout_path = Path(
            _write_normalized_receipt_log(
                handle=handle,
                name="stdout",
                content=stdout_inline_value,
                source_field="stdout_log",
                warnings=warnings,
            )
        )
    stdout_ok = stdout_path is not None and stdout_path.exists()
    checks.append(
        {
            "name": "stdout_evidence_present",
            "ok": stdout_ok,
            "detail": str(stdout_path) if stdout_ok else "stdout evidence missing",
        }
    )

    stderr_path_value = normalized.get("stderr_log_path")
    stderr_inline_value = normalized.get("stderr_log")
    stderr_path = _receipt_log_path(handle.project_root, stderr_path_value)
    if stderr_path is None:
        stderr_path = _receipt_log_path(handle.project_root, stderr_inline_value)
    if stderr_path is None:
        if isinstance(stderr_inline_value, str) and stderr_inline_value:
            stderr_path = Path(
                _write_normalized_receipt_log(
                    handle=handle,
                    name="stderr",
                    content=stderr_inline_value,
                    source_field="stderr_log",
                    warnings=warnings,
                )
            )
        elif observed_success:
            stderr_path = Path(
                _write_normalized_receipt_log(
                    handle=handle,
                    name="stderr",
                    content="",
                    source_field="stderr_log",
                    warnings=warnings,
                )
            )
            normalized["stderr_was_empty"] = True
    stderr_ok = stderr_path is not None and stderr_path.exists()
    checks.append(
        {
            "name": "stderr_evidence_present_or_empty",
            "ok": stderr_ok or observed_success,
            "detail": str(stderr_path) if stderr_ok else ("empty stderr accepted" if observed_success else "stderr evidence missing"),
        }
    )

    if stdout_ok:
        normalized["stdout_log_path"] = str(stdout_path)
        normalized.pop("stdout_log", None)
    if stderr_ok:
        normalized["stderr_log_path"] = str(stderr_path)
        normalized.pop("stderr_log", None)
    normalized = {key: normalized[key] for key in _RECEIPT_CANONICAL_FIELDS if key in normalized}
    checks.append(
        {
            "name": "receipt_logs_normalized",
            "ok": stdout_ok and (stderr_ok or observed_success),
            "detail": f"warnings={len(warnings)}",
        }
    )
    return normalized, checks, warnings, stdout_ok and (stderr_ok or observed_success)


def _execute_receipt_payload(phase_packet: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    artifacts = phase_packet.get("prior_artifacts") if isinstance(phase_packet.get("prior_artifacts"), dict) else {}
    execute_artifact = artifacts.get("execute")
    execute_payload = _read_json(Path(execute_artifact)) if isinstance(execute_artifact, str) and execute_artifact else {}
    receipt = execute_payload.get("official_validation_receipt") if isinstance(execute_payload, dict) else None
    return execute_payload if isinstance(execute_payload, dict) else {}, receipt if isinstance(receipt, dict) else {}


def mechanical_validate_phase_output(project_root: Path, phase_packet: dict[str, Any]) -> dict[str, Any]:
    """Confirm execute's official validator receipt without launching another worker."""

    run_id = str(phase_packet.get("run_id") or "")
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    strict_task = phase_packet.get("strict_task") if isinstance(phase_packet.get("strict_task"), dict) else {}
    execute_payload, receipt = _execute_receipt_payload(phase_packet)
    canonical_receipt, receipt_warnings = _canonicalize_official_validation_receipt(receipt=receipt if receipt else {})
    expected_command = _compact_whitespace(
        strict_task.get("eval_entrypoint", {}).get("command")
        if isinstance(strict_task.get("eval_entrypoint"), dict)
        else ""
    )
    actual_command = _compact_whitespace(canonical_receipt.get("command")) if canonical_receipt else ""
    checks: list[dict[str, Any]] = []

    receipt_present = bool(receipt)
    checks.append({"name": "receipt_present", "ok": receipt_present, "detail": "execute returned official_validation_receipt" if receipt_present else "execute output did not include official_validation_receipt"})

    command_matches = True
    if expected_command:
        command_matches = actual_command == expected_command
        relation, relation_rationale = _command_relation(expected_command, actual_command, {**receipt, **canonical_receipt})
        checks.append(
            {
                "name": "official_command_matches",
                "ok": command_matches,
                "blocking": False,
                "detail": f"diagnostic only; expected={expected_command} actual={actual_command or '<missing>'}",
            }
        )
        checks.append(
            {
                "name": "official_command_relation",
                "ok": relation not in {"missing", "not_equivalent"},
                "blocking": False,
                "detail": f"relation={relation} rationale={relation_rationale or '<none>'}",
            }
        )
    else:
        relation, relation_rationale = _command_relation(expected_command, actual_command, {**receipt, **canonical_receipt})

    exit_code = canonical_receipt.get("exit_code") if canonical_receipt else None
    exit_ok = isinstance(exit_code, int) and exit_code == 0
    checks.append({"name": "exit_code_zero", "ok": exit_ok, "detail": f"exit_code={exit_code!r}"})

    receipt_passed = canonical_receipt.get("passed") if canonical_receipt else None
    checks.append({"name": "receipt_passed", "ok": receipt_passed is True, "detail": f"passed={receipt_passed!r}"})

    command_success = bool(exit_ok and receipt_passed is True)
    observed_metric = execute_payload.get("metric_value")
    if not isinstance(observed_metric, (int, float, bool)):
        observed_metric = canonical_receipt.get("metric_value") if canonical_receipt else None
    if not isinstance(observed_metric, (int, float, bool)):
        observed_metric = 1 if command_success else 0
    threshold = _primary_metric_threshold(strict_task)
    direction = _primary_metric_direction(strict_task)
    metric_ok = _metric_meets_threshold(observed_metric, threshold, direction=direction)
    checks.append(
        {
            "name": "metric_threshold_met",
            "ok": metric_ok,
            "detail": f"value={observed_metric!r} direction={direction} threshold={threshold!r}",
        }
    )

    normalized_receipt, log_checks, log_warnings, logs_ok = _normalize_receipt_logs(
        handle=handle,
        receipt=canonical_receipt,
        observed_success=command_success,
    )
    log_warnings = [*receipt_warnings, *log_warnings]
    if receipt_present:
        normalized_receipt.setdefault("command", actual_command)
        normalized_receipt.setdefault("metric_name", _primary_metric_name(strict_task))
        normalized_receipt.setdefault("metric_value", observed_metric if command_success else 0)
        normalized_receipt.setdefault("metric_direction", direction)
        normalized_receipt.setdefault("threshold", threshold)
        if expected_command:
            normalized_receipt.setdefault("reference_command", expected_command)
        if relation:
            normalized_receipt.setdefault("command_relation", relation)
        if relation_rationale:
            normalized_receipt.setdefault("equivalence_rationale", relation_rationale)
    checks.extend(log_checks)

    drift_reason = _obvious_validator_drift(expected_command, actual_command)
    relation_preserves_intent = relation not in {"missing", "not_equivalent", "changed"}
    authority_preserved = bool(actual_command or not expected_command) and not bool(drift_reason)
    validator_intent_preserved = authority_preserved and relation_preserves_intent
    metric_preserved = metric_ok
    receipt_threshold = normalized_receipt.get("threshold") if normalized_receipt else None
    threshold_default = True if receipt_threshold is None else receipt_threshold == threshold
    threshold_preserved = threshold_default
    evidence_default = bool(command_success and logs_ok)
    evidence_sufficient = evidence_default
    checks.extend(
        [
            {
                "name": "authority_preserved",
                "ok": authority_preserved,
                "detail": "authority preserved" if authority_preserved else (drift_reason or "execute receipt declared authority drift"),
            },
            {
                "name": "validator_intent_preserved",
                "ok": validator_intent_preserved,
                "detail": (
                    f"relation={relation}"
                    if validator_intent_preserved
                    else (drift_reason or "execute receipt did not preserve validator intent")
                ),
            },
            {
                "name": "metric_preserved",
                "ok": metric_preserved,
                "detail": "metric preserved" if metric_preserved else "execute receipt declared metric drift",
            },
            {
                "name": "threshold_preserved",
                "ok": threshold_preserved,
                "detail": f"threshold={threshold!r} receipt_threshold={receipt_threshold!r}",
            },
            {
                "name": "official_validation_evidence_sufficient",
                "ok": evidence_sufficient,
                "detail": "exit code, receipt status, metric, and logs are sufficient" if evidence_sufficient else "official validation evidence is incomplete",
            },
        ]
    )

    checks_summary = receipt.get("checks_summary") if receipt else None
    if isinstance(checks_summary, list):
        for index, item in enumerate(checks_summary[:8], start=1):
            checks.append({"name": f"receipt_check_{index}", "ok": True, "detail": _short_plain(item, limit=240)})

    passed = bool(receipt_present and _blocking_checks_passed(checks) and receipt_passed is True)
    observed_success = bool(command_success and metric_ok and evidence_sufficient and authority_preserved and validator_intent_preserved and metric_preserved and threshold_preserved)
    failed = [str(check.get("name") or "check") for check in checks if check.get("ok") is False]
    summary = "Official validation evidence passed." if passed else "Official validation evidence failed: " + ", ".join(failed[:5])
    runtime_contract_problem = bool(command_success and not logs_ok)
    semantic_evidence_problem = bool(command_success and not (authority_preserved and validator_intent_preserved and metric_preserved and threshold_preserved and evidence_sufficient))
    if passed:
        failure_class = None
        runtime_contract_health = "ok"
    elif runtime_contract_problem:
        failure_class = "runtime_contract_error"
        runtime_contract_health = "runtime_contract_error"
    elif not metric_ok:
        failure_class = "metric_not_reached"
        runtime_contract_health = "failed"
    elif semantic_evidence_problem:
        failure_class = "evidence_insufficient"
        runtime_contract_health = "failed"
    else:
        failure_class = "execution_error"
        runtime_contract_health = "failed"
    return {
        "summary": summary,
        "passed": passed,
        "metric_name": _primary_metric_name(strict_task),
        "metric_value": observed_metric if command_success else 0,
        "threshold": threshold,
        "checks": checks,
        "official_validation_receipt": normalized_receipt,
        "execute_summary": execute_payload.get("summary"),
        "observed_validation": {
            "command": actual_command,
            "passed": observed_success,
            "exit_code": exit_code,
            "metric_value": observed_metric if command_success else 0,
            "metric_threshold_met": metric_ok,
            "expected_command": expected_command,
            "command_matches": command_matches,
            "command_relation": relation,
            "equivalence_rationale": relation_rationale,
            "authority_preserved": authority_preserved,
            "validator_intent_preserved": validator_intent_preserved,
            "metric_preserved": metric_preserved,
            "threshold_preserved": threshold_preserved,
            "evidence_sufficient": evidence_sufficient,
            "validator_drift_reason": drift_reason,
        },
        "runtime_contract_health": runtime_contract_health,
        "failure_class": failure_class,
        "acceptance_state": "validated" if passed else ("needs_human_review" if failure_class == "evidence_insufficient" else "not_closed"),
        "_normalization_warnings": log_warnings,
    }


def _build_run_result_payload(controller: dict[str, Any]) -> dict[str, Any]:
    strict_task = controller.get("strict_task") if isinstance(controller.get("strict_task"), dict) else {}
    validate_payload = {}
    validate_artifact = controller.get("artifacts", {}).get("validate")
    if isinstance(validate_artifact, str):
        validate_payload = _read_json(Path(validate_artifact))
    metric_name = validate_payload.get("metric_name")
    metric_value = validate_payload.get("metric_value")
    metrics = {}
    if isinstance(metric_name, str) and metric_name:
        metrics[metric_name] = metric_value
    return {
        "phase_statuses": controller.get("phase_statuses", {}),
        "validate_passed": bool(controller.get("validate_passed")),
        "final_summary": controller.get("final_summary"),
        "artifacts": controller.get("artifacts", {}),
        "next_hint": controller.get("next_hint"),
        "metrics": metrics,
        "primary_metric": strict_task.get("primary_metric", {}),
        "observed_validation": validate_payload.get("observed_validation") if isinstance(validate_payload.get("observed_validation"), dict) else {},
        "runtime_contract_health": validate_payload.get("runtime_contract_health"),
        "acceptance_state": validate_payload.get("acceptance_state"),
        "failure_class": validate_payload.get("failure_class"),
    }


def _plan_has_authority_gaps(payload: dict[str, Any]) -> bool:
    if payload.get("authority_complete") is not True:
        return True
    open_gaps = payload.get("open_gaps")
    if isinstance(open_gaps, list) and any(isinstance(item, str) and item.strip() for item in open_gaps):
        return True
    forbidden = payload.get("forbidden_assumptions_used")
    if isinstance(forbidden, list) and any(isinstance(item, str) and item.strip() for item in forbidden):
        return True
    return False


def _reflect_feedback_state(controller: dict[str, Any]) -> dict[str, Any]:
    value = controller.get("reflect_feedback")
    if not isinstance(value, dict):
        value = {"max_retries": RUN_REFLECT_FEEDBACK_LIMIT, "attempts": []}
    attempts = value.get("attempts")
    if not isinstance(attempts, list):
        value["attempts"] = []
    max_retries = value.get("max_retries")
    if not isinstance(max_retries, int) or max_retries < 0:
        value["max_retries"] = RUN_REFLECT_FEEDBACK_LIMIT
    return value


def _reflect_next_hint(payload: dict[str, Any]) -> str:
    for field in ("corrective_prompt", "next_plan_hint", "next_recommendation"):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _archive_phase_artifacts_for_reflect_retry(handle: RunHandle, controller: dict[str, Any], retry_index: int) -> dict[str, str]:
    retry_dir = handle.run_dir / "phase-retries" / f"retry-{retry_index}"
    retry_dir.mkdir(parents=True, exist_ok=True)
    archived: dict[str, str] = {}
    artifacts = controller.get("artifacts") if isinstance(controller.get("artifacts"), dict) else {}
    for phase in ("execute", "validate", "reflect"):
        source = artifacts.get(phase)
        if not isinstance(source, str) or not source:
            continue
        source_path = Path(source)
        if not source_path.exists():
            continue
        target = retry_dir / f"{phase}.json"
        shutil.copyfile(source_path, target)
        archived[phase] = str(target)
        record_artifact(
            handle.project_root,
            handle.run_id,
            path=str(target),
            label=f"reflect-retry-{retry_index}-{phase}.json",
            artifact_kind="phase_retry",
            metadata={"phase": phase, "retry_index": retry_index},
        )
    return archived


def _reflect_authorizes_execute_retry(controller: dict[str, Any], payload: dict[str, Any]) -> bool:
    if bool(controller.get("validate_passed")):
        return False
    prior_validate = _prior_validate_payload(controller) or {}
    if prior_validate.get("runtime_contract_health") == "runtime_contract_error":
        return False
    if prior_validate.get("failure_class") == "runtime_contract_error":
        return False
    if payload.get("retry_authorized") is not True:
        return False
    feedback = _reflect_feedback_state(controller)
    attempts = feedback.get("attempts") if isinstance(feedback.get("attempts"), list) else []
    return len(attempts) < int(feedback.get("max_retries") or RUN_REFLECT_FEEDBACK_LIMIT)


def _phase_outcome_for_run(handle: RunHandle, controller: dict[str, Any], phase: str, payload: dict[str, Any]) -> PhaseOutcome:
    phase_statuses = controller.get("phase_statuses") if isinstance(controller.get("phase_statuses"), dict) else {}
    phase_statuses[phase] = "completed"
    controller["phase_statuses"] = phase_statuses
    controller.setdefault("artifacts", {})
    controller["artifacts"][phase] = _write_phase_artifact(handle, phase, payload)
    controller["final_summary"] = str(payload.get("summary") or controller.get("final_summary") or "").strip() or None
    controller["next_hint"] = _reflect_next_hint(payload) if phase == "reflect" else controller.get("next_hint")
    _write_phase_state(handle, controller)
    if phase == "plan":
        if _plan_has_authority_gaps(payload):
            phase_statuses["plan"] = "failed"
            controller["phase_statuses"] = phase_statuses
            controller["next_hint"] = "return to discuss and close authority gaps"
            _write_phase_state(handle, controller)
            return PhaseOutcome(
                True,
                "failed",
                str(payload.get("summary") or "plan needs input"),
                None,
                result_payload=_build_run_result_payload(controller),
                reason="needs_input",
            )
        if payload.get("history_action") == "needs_input":
            phase_statuses["plan"] = "failed"
            controller["phase_statuses"] = phase_statuses
            controller["next_hint"] = "return to discuss and resolve history or authority gaps"
            _write_phase_state(handle, controller)
            return PhaseOutcome(
                True,
                "failed",
                str(payload.get("summary") or "plan needs input"),
                None,
                result_payload=_build_run_result_payload(controller),
                reason="needs_input",
            )
        if payload.get("history_action") == "close_from_history":
            reconciled = _history_reconcile_current_run(handle, controller)
            if reconciled is not None:
                return reconciled
        _update_state(handle, phase="execute", progress_pct=RUN_PHASE_PROGRESS["plan"])
        return PhaseOutcome(False, "running", str(payload.get("summary") or "plan complete"), "execute")
    if phase == "execute":
        _update_state(handle, phase="validate", progress_pct=RUN_PHASE_PROGRESS["execute"])
        return PhaseOutcome(False, "running", str(payload.get("summary") or "execute complete"), "validate")
    if phase == "validate":
        passed = bool(payload.get("passed"))
        controller["validate_passed"] = passed
        phase_statuses["validate"] = "completed" if passed else "failed"
        controller["phase_statuses"] = phase_statuses
        controller["next_hint"] = "reflect on validation evidence" if passed else "reflect before deciding next iteration"
        _write_phase_state(handle, controller)
        _update_state(handle, phase="reflect", progress_pct=RUN_PHASE_PROGRESS["validate"])
        return PhaseOutcome(False, "running", str(payload.get("summary") or "validation complete"), "reflect")
    if phase == "reflect":
        phase_statuses["reflect"] = "completed"
        controller["phase_statuses"] = phase_statuses
        next_hint = _reflect_next_hint(payload)
        if next_hint:
            controller["next_hint"] = next_hint
        if _reflect_authorizes_execute_retry(controller, payload):
            feedback = _reflect_feedback_state(controller)
            attempts = feedback.get("attempts") if isinstance(feedback.get("attempts"), list) else []
            retry_index = len(attempts) + 1
            corrective_prompt = _reflect_next_hint(payload)
            archived = _archive_phase_artifacts_for_reflect_retry(handle, controller, retry_index)
            guidance_entry = append_run_guidance(
                handle.project_root,
                handle.run_id,
                message=corrective_prompt,
                source="reflect_feedback",
                phase="execute",
                interrupt_requested=False,
            )
            attempts.append(
                {
                    "retry_index": retry_index,
                    "created_at": utc_now(),
                    "guidance_id": guidance_entry.get("guidance_id"),
                    "corrective_prompt": corrective_prompt,
                    "archived_artifacts": archived,
                    "failure_class": (_prior_validate_payload(controller) or {}).get("failure_class"),
                }
            )
            feedback["attempts"] = attempts
            controller["reflect_feedback"] = feedback
            controller["phase_statuses"]["execute"] = "retry_pending"
            controller["phase_statuses"]["validate"] = "retry_pending"
            controller["next_hint"] = corrective_prompt
            _write_phase_state(handle, controller)
            _append_event(
                handle,
                "reflect corrective feedback scheduled execute retry",
                kind="reflect",
                level="warning",
                payload={"retry_index": retry_index, "guidance_id": guidance_entry.get("guidance_id")},
            )
            _update_state(handle, phase="execute", progress_pct=RUN_PHASE_PROGRESS["execute"])
            return PhaseOutcome(False, "running", str(payload.get("summary") or "reflect scheduled execute retry"), "execute")
        _write_phase_state(handle, controller)
        result_payload = _build_run_result_payload(controller)
        if bool(controller.get("validate_passed")):
            return PhaseOutcome(True, "completed", str(payload.get("summary") or "reflection complete"), None, result_payload=result_payload)
        reason = str((_prior_validate_payload(controller) or {}).get("failure_class") or "validation_failed")
        return PhaseOutcome(True, "failed", str(payload.get("summary") or "reflection complete"), None, result_payload=result_payload, reason=reason)
    raise ValueError(f"unsupported phase: {phase}")


def submit_phase_output(project_root: Path, run_id: str, *, phase: str, payload: dict[str, Any]) -> dict[str, Any]:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    controller = load_phase_state(handle)
    if not controller:
        raise FileNotFoundError(f"Run {run_id} is missing phase_state.json")
    if controller.get("mode") == "loop_parent":
        return _submit_phase_to_loop_parent(handle, phase=phase, payload=payload)
    current_phase = str(controller.get("current_phase") or "")
    if current_phase != phase:
        raise ValueError(f"run {run_id} expects phase {current_phase}, not {phase}")
    strict_task = controller.get("strict_task") if isinstance(controller.get("strict_task"), dict) else {}
    validate_schema = strict_task.get("validate_output_schema") if phase == "validate" else None
    normalized_payload = _require_phase_payload(
        phase,
        payload,
        validate_schema=validate_schema if isinstance(validate_schema, dict) else None,
        prior_validate_payload=_prior_validate_payload(controller) if phase == "reflect" else None,
    )
    heartbeat_run(project_root, run_id, phase=phase, progress_pct=RUN_PHASE_PROGRESS.get(phase, 50), note=f"{phase} output received")
    outcome = _phase_outcome_for_run(handle, controller, phase, normalized_payload)
    if outcome.terminal and outcome.status == "completed":
        complete_run(project_root, run_id, summary=outcome.summary, result_payload=outcome.result_payload)
        return {"terminal": True, "status": "completed", "summary": outcome.summary, "result": outcome.result_payload}
    if outcome.terminal and outcome.status == "failed":
        fail_run(project_root, run_id, summary=outcome.summary, reason=outcome.reason, result_payload=outcome.result_payload)
        return {"terminal": True, "status": "failed", "summary": outcome.summary, "result": outcome.result_payload, "reason": outcome.reason}
    controller = load_phase_state(handle)
    controller["current_phase"] = outcome.next_phase
    _write_phase_state(handle, controller)
    return {"terminal": False, "status": "running", "next_phase": outcome.next_phase, "summary": outcome.summary}


def _loop_budget_exhausted(controller: dict[str, Any]) -> bool:
    loop = controller.get("loop") if isinstance(controller.get("loop"), dict) else {}
    max_iterations = int(loop.get("max_iterations") or DEFAULT_LOOP_MAX_ITERATIONS)
    iterations_attempted = int(loop.get("iterations_attempted") or 0)
    started_at_epoch = float(loop.get("started_at_epoch") or time())
    max_runtime_seconds = int(loop.get("max_runtime_seconds") or DEFAULT_LOOP_MAX_RUNTIME_SECONDS)
    if iterations_attempted >= max_iterations and not loop.get("active_child_run_id"):
        loop["budget_exhausted_by"] = "max_iterations"
        controller["loop"] = loop
        return True
    if (time() - started_at_epoch) >= max_runtime_seconds and not loop.get("active_child_run_id"):
        loop["budget_exhausted_by"] = "max_runtime_seconds"
        controller["loop"] = loop
        return True
    return False


def _short_plain(value: Any, *, limit: int = 240) -> str:
    text = str(value or "").strip().replace("\n", " ")
    return text[:limit]


def _compact_reflect(reflect: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(reflect, dict):
        return {}
    compact: dict[str, Any] = {}
    for key in ("outcome", "failure_class", "root_cause", "corrective_prompt", "next_plan_hint", "next_recommendation"):
        value = reflect.get(key)
        if isinstance(value, str) and value.strip():
            compact[key] = _short_plain(value)
    for key in ("evidence", "residual_risks"):
        value = reflect.get(key)
        if isinstance(value, list):
            compact[key] = [_short_plain(item, limit=160) for item in value if isinstance(item, str) and item.strip()][:3]
    return compact


def _loop_failure_signature(child_result: dict[str, Any], reflect: dict[str, Any]) -> str:
    failure_class = _short_plain(reflect.get("failure_class") or child_result.get("reason") or "validation_failed", limit=48)
    root_cause = _short_plain(reflect.get("root_cause") or child_result.get("summary") or "unknown", limit=160)
    return f"{failure_class}|{root_cause}"


def _retry_history(loop: dict[str, Any]) -> list[dict[str, Any]]:
    rows = loop.get("retry_history")
    return [dict(item) for item in rows if isinstance(item, dict)] if isinstance(rows, list) else []


def _retry_count_for_signature(loop: dict[str, Any], signature: str) -> int:
    return sum(
        1
        for item in _retry_history(loop)
        if item.get("failure_signature") == signature and item.get("action") == "retry"
    )


def _loop_retry_decision(loop: dict[str, Any], child_result: dict[str, Any], reflect: dict[str, Any]) -> dict[str, Any]:
    signature = _loop_failure_signature(child_result, reflect)
    retry_limit = loop.get("retry_limit")
    if not isinstance(retry_limit, int) or retry_limit < 0:
        retry_limit = DEFAULT_LOOP_RETRY_LIMIT
    reason = str(child_result.get("reason") or reflect.get("failure_class") or "validation_failed").strip()
    next_plan_hint = _reflect_next_hint(reflect)
    non_retryable_reasons = {
        "needs_input",
        "runtime_contract_error",
        "missing acceptance_spec",
        "lease_conflict",
        "stopped",
        "cancelled",
        "worker bootstrap timeout",
    }
    if reason in non_retryable_reasons:
        return {
            "action": "stop",
            "reason": reason,
            "failure_signature": signature,
            "next_plan_hint": next_plan_hint,
        }
    if not next_plan_hint:
        return {
            "action": "stop",
            "reason": "missing_next_plan_hint",
            "failure_signature": signature,
            "next_plan_hint": next_plan_hint,
        }
    prior_retries = _retry_count_for_signature(loop, signature)
    if prior_retries >= retry_limit:
        return {
            "action": "stop",
            "reason": "repeat_failure_limit",
            "failure_signature": signature,
            "retry_count": prior_retries,
            "max_retries": retry_limit,
            "next_plan_hint": next_plan_hint,
        }
    return {
        "action": "retry",
        "reason": "bounded_retry",
        "failure_signature": signature,
        "retry_count": prior_retries + 1,
        "max_retries": retry_limit,
        "next_plan_hint": next_plan_hint,
    }


def _build_loop_context(loop: dict[str, Any]) -> dict[str, Any]:
    history = _retry_history(loop)[-3:]
    child_run_ids = [item for item in loop.get("child_run_ids", []) if isinstance(item, str)] if isinstance(loop.get("child_run_ids"), list) else []
    context = {
        "previous_failure_summary": _short_plain(loop.get("last_failure_summary")),
        "previous_reflect": _compact_reflect(loop.get("last_reflect") if isinstance(loop.get("last_reflect"), dict) else {}),
        "last_retry_decision": loop.get("last_retry_decision") if isinstance(loop.get("last_retry_decision"), dict) else {},
        "recent_retry_history": history,
        "recent_child_run_ids": child_run_ids[-3:],
    }
    return {key: value for key, value in context.items() if value not in ("", {}, [])}


def create_child_run(
    parent_handle: RunHandle,
    *,
    strict_task: dict[str, Any],
    goal: str,
    iteration_index: int,
    prior_reflect: dict[str, Any] | None = None,
    review_context: dict[str, Any] | None = None,
    loop_context: dict[str, Any] | None = None,
    guidance: dict[str, Any] | None = None,
) -> RunHandle:
    from .ledger import create_run

    run = parent_handle.run_json()
    child = create_run(
        parent_handle.project_root,
        kind="run",
        title=str(strict_task.get("title") or run.get("title") or run.get("work_id") or "run"),
        work_id=str(run.get("work_id") or strict_task.get("work_id") or "") or None,
        work_revision=int(run.get("work_revision") or strict_task.get("revision") or 0) or None,
        host=str(run.get("host") or "codex"),
        executor=str(run.get("executor") or "claude"),
        dispatch_mode=str(run.get("dispatch_mode") or "live_native"),
        sleep_requested=bool(run.get("sleep_requested")),
        max_runtime_seconds=int(
            normalize_runtime_contract(strict_task.get("runtime_contract"))["loop"]["max_runtime_seconds"]
        ),
        target=run.get("target"),
        parent_run_id=parent_handle.run_id,
        iteration_index=iteration_index,
    )
    initialize_run_phase_state(
        child,
        strict_task=strict_task,
        goal=goal,
        target=run.get("target"),
        prior_reflect=prior_reflect,
        review_context=review_context,
        loop_context=loop_context,
        guidance=guidance,
    )
    return child


def _submit_phase_to_loop_parent(handle: RunHandle, *, phase: str, payload: dict[str, Any]) -> dict[str, Any]:
    controller = load_phase_state(handle)
    loop = controller.get("loop") if isinstance(controller.get("loop"), dict) else {}
    active_child_id = str(loop.get("active_child_run_id") or "").strip()
    if not active_child_id:
        raise ValueError(f"loop {handle.run_id} has no active child run")
    child_result = submit_phase_output(handle.project_root, active_child_id, phase=phase, payload=payload)
    if child_result.get("terminal") is not True:
        child_handle = RunHandle(project_root=handle.project_root, run_id=active_child_id)
        child_controller = load_phase_state(child_handle)
        _update_state(handle, phase=str(child_controller.get("current_phase") or phase), progress_pct=int(child_handle.state_json().get("progress_pct") or 1))
        return {
            "terminal": False,
            "status": "running",
            "active_child_run_id": active_child_id,
            "next_phase": child_result.get("next_phase"),
            "iteration_index": loop.get("iterations_attempted"),
        }

    child_result_payload = child_result.get("result") if isinstance(child_result.get("result"), dict) else {}
    loop["active_child_run_id"] = None
    if child_result.get("status") == "completed" and child_result_payload.get("validate_passed") is True:
        loop["final_outcome"] = "validated"
        loop["budget_exhausted_by"] = None
        controller["loop"] = loop
        _write_phase_state(handle, controller)
        _upsert_loop_controller_object(handle, controller)
        result_payload = {
            "phase_statuses": {"loop": "completed"},
            "validate_passed": True,
            "final_summary": child_result.get("summary"),
            "artifacts": {
                "child_run_ids": loop.get("child_run_ids", []),
                "last_child_run_id": active_child_id,
            },
            "next_hint": None,
            "iterations_attempted": loop.get("iterations_attempted"),
            "child_run_ids": loop.get("child_run_ids", []),
            "last_failure_summary": loop.get("last_failure_summary"),
            "budget_exhausted_by": None,
            "final_outcome": "validated",
        }
        complete_run(handle.project_root, handle.run_id, summary=str(child_result.get("summary") or "loop completed"), result_payload=result_payload)
        return {"terminal": True, "status": "completed", "summary": child_result.get("summary"), "result": result_payload}

    loop["last_failure_summary"] = child_result.get("summary")
    child_controller = load_phase_state(RunHandle(project_root=handle.project_root, run_id=active_child_id))
    reflect_path = child_controller.get("artifacts", {}).get("reflect") if isinstance(child_controller.get("artifacts"), dict) else None
    loop["last_reflect"] = _read_json(Path(reflect_path)) if isinstance(reflect_path, str) and reflect_path else {}
    retry_decision = _loop_retry_decision(loop, child_result, loop["last_reflect"])
    retry_decision["child_run_id"] = active_child_id
    retry_decision["decided_at"] = utc_now()
    loop["last_retry_decision"] = retry_decision
    retry_history = _retry_history(loop)
    retry_history.append(retry_decision)
    loop["retry_history"] = retry_history
    controller["loop"] = loop
    controller = _write_phase_state(handle, controller)
    _upsert_loop_controller_object(handle, controller)
    if _loop_budget_exhausted(controller):
        loop = controller.get("loop") if isinstance(controller.get("loop"), dict) else {}
        loop["final_outcome"] = "budget_exhausted"
        controller["loop"] = loop
        _write_phase_state(handle, controller)
        _upsert_loop_controller_object(handle, controller)
        result_payload = {
            "phase_statuses": {"loop": "failed"},
            "validate_passed": False,
            "final_summary": child_result.get("summary"),
            "artifacts": {"child_run_ids": loop.get("child_run_ids", [])},
            "next_hint": _reflect_next_hint(loop.get("last_reflect", {}) if isinstance(loop.get("last_reflect"), dict) else {}),
            "iterations_attempted": loop.get("iterations_attempted"),
            "child_run_ids": loop.get("child_run_ids", []),
            "last_failure_summary": loop.get("last_failure_summary"),
            "budget_exhausted_by": loop.get("budget_exhausted_by"),
            "final_outcome": "budget_exhausted",
            "retry_decision": retry_decision,
            "retry_history": loop.get("retry_history", []),
        }
        fail_run(
            handle.project_root,
            handle.run_id,
            summary=str(child_result.get("summary") or "loop exhausted budget"),
            reason=str(loop.get("budget_exhausted_by") or "budget_exhausted"),
            result_payload=result_payload,
        )
        return {
            "terminal": True,
            "status": "failed",
            "summary": child_result.get("summary"),
            "reason": loop.get("budget_exhausted_by"),
            "result": result_payload,
        }
    if retry_decision.get("action") != "retry":
        loop = controller.get("loop") if isinstance(controller.get("loop"), dict) else {}
        loop["final_outcome"] = "stopped_by_retry_policy"
        controller["loop"] = loop
        _write_phase_state(handle, controller)
        _upsert_loop_controller_object(handle, controller)
        result_payload = {
            "phase_statuses": {"loop": "failed"},
            "validate_passed": False,
            "final_summary": child_result.get("summary"),
            "artifacts": {"child_run_ids": loop.get("child_run_ids", [])},
            "next_hint": retry_decision.get("next_plan_hint") or _reflect_next_hint(loop.get("last_reflect", {}) if isinstance(loop.get("last_reflect"), dict) else {}),
            "iterations_attempted": loop.get("iterations_attempted"),
            "child_run_ids": loop.get("child_run_ids", []),
            "last_failure_summary": loop.get("last_failure_summary"),
            "budget_exhausted_by": None,
            "final_outcome": "stopped_by_retry_policy",
            "retry_decision": retry_decision,
            "retry_history": loop.get("retry_history", []),
        }
        fail_run(
            handle.project_root,
            handle.run_id,
            summary=str(child_result.get("summary") or "loop stopped by retry policy"),
            reason=str(retry_decision.get("reason") or "retry_policy_stop"),
            result_payload=result_payload,
        )
        return {
            "terminal": True,
            "status": "failed",
            "summary": child_result.get("summary"),
            "reason": retry_decision.get("reason"),
            "result": result_payload,
        }
    _append_event(
        handle,
        "loop iteration failed; retry decision recorded",
        kind="loop",
        level="warning",
        payload={"failed_child_run_id": active_child_id, "retry_decision": retry_decision},
    )
    _update_state(handle, phase="plan", progress_pct=max(1, int(handle.state_json().get("progress_pct") or 1)))
    return {
        "terminal": False,
        "status": "running",
        "next_phase": "plan",
        "summary": child_result.get("summary"),
        "iteration_index": loop.get("iterations_attempted"),
    }


def execute_background_controller(
    project_root: Path,
    run_id: str,
    *,
    driver: PhaseDriver,
) -> int:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    while True:
        state = handle.state_json()
        if state.get("status") == "stopping":
            return 0
        phase_packet = next_phase_payload(project_root, run_id)
        if phase_packet.get("terminal") is True:
            return 0
        phase = str(phase_packet.get("phase") or "")
        phase_output = (
            mechanical_validate_phase_output(project_root, phase_packet)
            if phase == "validate"
            else driver.execute_phase(handle=handle, phase_packet=phase_packet)
        )
        response = submit_phase_output(project_root, run_id, phase=phase, payload=phase_output)
        if response.get("terminal") is True:
            return 0 if response.get("status") == "completed" else 1
