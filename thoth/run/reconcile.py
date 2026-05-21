"""Historical run reconciliation for successful execute validator receipts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .io import _read_json, _write_json
from .ledger import complete_run, record_artifact
from .model import RunHandle, utc_now
from .phases import (
    _build_run_result_payload,
    _write_phase_state,
    _write_phase_artifact,
    load_phase_state,
    mechanical_validate_phase_output,
)


def _refused(run_id: str, reason: str, *, detail: Any | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "refused",
        "run_id": run_id,
        "reason": reason,
        "changed": False,
    }
    if detail is not None:
        payload["detail"] = detail
    return payload


def _execute_artifact_path(handle: RunHandle, controller: dict[str, Any]) -> Path | None:
    artifacts = controller.get("artifacts") if isinstance(controller.get("artifacts"), dict) else {}
    candidate = artifacts.get("execute")
    if isinstance(candidate, str) and candidate.strip():
        path = Path(candidate)
        if not path.is_absolute():
            path = handle.project_root / path
        if path.exists():
            return path
    fallback = handle.run_dir / "execute.json"
    return fallback if fallback.exists() else None


def _write_reconcile_artifact(
    handle: RunHandle,
    *,
    previous_result: dict[str, Any],
    validate_payload: dict[str, Any],
    validate_artifact: str,
) -> str:
    payload = {
        "schema_version": 1,
        "run_id": handle.run_id,
        "status": "reconciled",
        "basis": "execute_official_validation_receipt",
        "changed_at": utc_now(),
        "previous_status": previous_result.get("status"),
        "previous_reason": previous_result.get("reason"),
        "validate_artifact": validate_artifact,
        "observed_validation": validate_payload.get("observed_validation"),
        "runtime_contract_health": validate_payload.get("runtime_contract_health"),
        "acceptance_state": validate_payload.get("acceptance_state"),
        "normalization_warnings": validate_payload.get("_normalization_warnings", []),
    }
    path = handle.run_dir / "reconcile.json"
    _write_json(path, payload)
    record_artifact(
        handle.project_root,
        handle.run_id,
        path=str(path),
        label=path.name,
        artifact_kind="reconcile",
        metadata={"basis": "execute_official_validation_receipt"},
    )
    return str(path)


def reconcile_run(project_root: Path, run_id: str) -> dict[str, Any]:
    """Close an old failed run when execute already proved official validation.

    This intentionally does not rerun validators and does not touch project source
    files. It only rewrites Thoth runtime ledgers when the existing execute phase
    receipt satisfies the current mechanical validate contract.
    """

    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    run_payload = handle.run_json()
    if not run_payload:
        raise FileNotFoundError(f"Run {run_id} not found")
    previous_result = handle.result_json()
    state = handle.state_json()
    result_status = str(previous_result.get("status") or state.get("status") or "")
    if result_status == "completed":
        return _refused(run_id, "run_already_completed")
    if result_status not in {"failed", "stopped"}:
        return _refused(run_id, "run_not_failed_or_stopped", detail={"status": result_status})

    controller = load_phase_state(handle)
    if not controller:
        return _refused(run_id, "missing_phase_state")
    execute_artifact = _execute_artifact_path(handle, controller)
    if execute_artifact is None:
        return _refused(run_id, "missing_execute_artifact")

    strict_task = controller.get("strict_task") if isinstance(controller.get("strict_task"), dict) else {}
    phase_packet = {
        "schema_version": 1,
        "run_id": run_id,
        "work_id": run_payload.get("work_id"),
        "work_revision": run_payload.get("work_revision"),
        "phase": "validate",
        "strict_task": strict_task,
        "prior_artifacts": {"execute": str(execute_artifact)},
    }
    validate_payload = mechanical_validate_phase_output(handle.project_root, phase_packet)
    if validate_payload.get("passed") is not True:
        return _refused(
            run_id,
            "execute_receipt_did_not_pass_current_validate_contract",
            detail={
                "summary": validate_payload.get("summary"),
                "failure_class": validate_payload.get("failure_class"),
                "checks": validate_payload.get("checks"),
            },
        )

    controller.setdefault("artifacts", {})
    controller.setdefault("phase_statuses", {})
    validate_artifact = _write_phase_artifact(handle, "validate", validate_payload)
    controller["artifacts"]["validate"] = validate_artifact
    controller["phase_statuses"]["validate"] = "completed"
    if not controller["phase_statuses"].get("reflect"):
        controller["phase_statuses"]["reflect"] = "completed"
    controller["current_phase"] = "conclusion"
    controller["validate_passed"] = True
    controller["final_summary"] = "Historical run reconciled from a passing execute official validator receipt."
    controller["next_hint"] = None
    reconcile_artifact = _write_reconcile_artifact(
        handle,
        previous_result=previous_result,
        validate_payload=validate_payload,
        validate_artifact=validate_artifact,
    )
    controller["artifacts"]["reconcile"] = reconcile_artifact
    _write_phase_state(handle, controller)

    result_payload = _build_run_result_payload(controller)
    result_payload["reconciled"] = True
    result_payload["reconcile"] = {
        "basis": "execute_official_validation_receipt",
        "artifact": reconcile_artifact,
        "previous_status": previous_result.get("status"),
        "previous_reason": previous_result.get("reason"),
    }
    complete_run(
        handle.project_root,
        run_id,
        summary="Historical run reconciled from a passing execute official validator receipt.",
        result_payload=result_payload,
    )
    return {
        "status": "ok",
        "run_id": run_id,
        "work_id": run_payload.get("work_id"),
        "changed": True,
        "validate_artifact": validate_artifact,
        "reconcile_artifact": reconcile_artifact,
        "observed_validation": validate_payload.get("observed_validation"),
        "normalization_warnings": validate_payload.get("_normalization_warnings", []),
    }
