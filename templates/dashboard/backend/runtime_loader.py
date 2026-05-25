"""
runtime_loader.py -- Canonical run-ledger reader for the Thoth dashboard.

The dashboard must not infer long-running execution state from chat history or
task YAML files. Runtime truth lives under `.thoth/runs/<run_id>/`.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ACTIVE_RUN_STATUSES = {"queued", "running", "paused", "waiting_input", "stopping"}
RUN_PHASES = ("plan", "execute", "validate", "reflect")


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_timestamp(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            payload.setdefault("_line_no", line_no)
            records.append(payload)
    return records


def _short_text(value: Any, *, limit: int = 220) -> str:
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    else:
        text = str(value or "")
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)] + "..."


def _section(title: str, items: list[Any], *, limit: int = 8) -> dict[str, Any] | None:
    rows = [_short_text(item) for item in items if _short_text(item)]
    if not rows:
        return None
    return {"title": title, "items": rows[:limit], "truncated": len(rows) > limit}


def _body_section(title: str, value: Any, *, limit: int = 1200) -> dict[str, Any] | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return {"title": title, "items": [_short_text(value, limit=limit)], "truncated": len(value) > limit}


def _mixed_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_short_text(item) for item in value]


def _warning_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    rows: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            rows.append(_short_text(item))
            continue
        field = item.get("field")
        reason = item.get("reason")
        if field or reason:
            rows.append(_short_text(f"{field or 'field'}: {reason or 'normalized'}"))
        else:
            rows.append(_short_text(item))
    return rows


def _event_seq(event: dict[str, Any]) -> int:
    seq = event.get("seq")
    if isinstance(seq, int):
        return seq
    return int(event.get("_line_no", 0))


def _normalize_event(event: dict[str, Any]) -> dict[str, Any]:
    payload = dict(event)
    payload["seq"] = _event_seq(payload)
    payload["ts"] = payload.get("ts") or payload.get("timestamp")
    payload["kind"] = payload.get("kind") or payload.get("type") or "event"
    payload["level"] = payload.get("level") or "info"
    payload["message"] = payload.get("message") or payload.get("summary") or ""
    payload.pop("_line_no", None)
    return payload


def _latest_ts(*values: Any) -> Optional[str]:
    parsed = [_parse_timestamp(v) for v in values]
    parsed = [value for value in parsed if value is not None]
    if not parsed:
        return None
    return _format_timestamp(max(parsed))


def _runs_dir(project_root: Path) -> Path:
    return Path(os.environ.get("THOTH_RUNS_DIR", str(project_root / ".thoth" / "runs"))).resolve()


def list_runs(project_root: Path) -> list[dict[str, Any]]:
    project_root = project_root.resolve()
    runs_dir = _runs_dir(project_root)
    if not runs_dir.is_dir():
        return []

    stale_minutes = int(os.environ.get("THOTH_HEARTBEAT_STALE_MINUTES", "20"))
    now = datetime.now(timezone.utc)
    runs: list[dict[str, Any]] = []

    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue

        run_data = _read_json(run_dir / "run.json")
        state_data = _read_json(run_dir / "state.json")
        result_data = _read_json(run_dir / "result.json")
        artifacts_data = _read_json(run_dir / "artifacts.json")
        supervisor_data = _read_json(run_dir / "supervisor.json")
        events = [_normalize_event(event) for event in _read_jsonl(run_dir / "events.jsonl")]
        events.sort(key=lambda item: item["seq"])

        run_id = str(run_data.get("run_id") or run_data.get("id") or state_data.get("run_id") or run_dir.name)
        work_id = run_data.get("work_id") or state_data.get("work_id")
        status = str(state_data.get("status") or run_data.get("status") or result_data.get("status") or "unknown")
        progress_pct = state_data.get("progress_pct")
        if not isinstance(progress_pct, (int, float)):
            progress_pct = state_data.get("progress")
        if not isinstance(progress_pct, (int, float)):
            progress_pct = 0.0
        progress_pct = round(max(0.0, min(100.0, float(progress_pct))), 1)

        last_event = events[-1] if events else None
        last_heartbeat_at = state_data.get("last_heartbeat_at")
        last_updated_at = _latest_ts(
            state_data.get("updated_at"),
            last_heartbeat_at,
            result_data.get("updated_at"),
            last_event.get("ts") if last_event else None,
            run_data.get("updated_at"),
            run_data.get("created_at"),
        )
        hb_dt = _parse_timestamp(last_heartbeat_at)
        is_stale = False
        if hb_dt is not None and status in ACTIVE_RUN_STATUSES:
            is_stale = (now - hb_dt).total_seconds() > stale_minutes * 60
        is_active = status in ACTIVE_RUN_STATUSES and not is_stale

        runs.append({
            "run_id": run_id,
            "work_id": work_id,
            "title": run_data.get("title") or run_id,
            "host": run_data.get("host"),
            "status": status,
            "phase": state_data.get("phase") or run_data.get("phase"),
            "progress_pct": progress_pct,
            "executor": run_data.get("executor"),
            "attachable": bool(run_data.get("attachable", True)),
            "created_at": run_data.get("created_at"),
            "started_at": run_data.get("started_at") or run_data.get("created_at"),
            "last_updated_at": last_updated_at,
            "last_heartbeat_at": last_heartbeat_at,
            "last_event_seq": state_data.get("last_event_seq") if isinstance(state_data.get("last_event_seq"), int) else (last_event["seq"] if last_event else 0),
            "is_active": is_active,
            "is_stale": is_stale,
            "stale": is_stale,
            "supervisor_state": state_data.get("supervisor_state") or supervisor_data.get("state"),
            "latest_message": last_event.get("message") if last_event else "",
            "artifact_count": len(artifacts_data.get("artifacts", [])) if isinstance(artifacts_data.get("artifacts"), list) else 0,
            "events_path": str((run_dir / "events.jsonl").resolve().relative_to(project_root)) if (run_dir / "events.jsonl").exists() else None,
        })

    runs.sort(
        key=lambda item: (
            _parse_timestamp(item.get("last_updated_at")) or datetime.min.replace(tzinfo=timezone.utc),
            item["run_id"],
        ),
        reverse=True,
    )
    return runs


def get_work_item_runs(project_root: Path, work_id: str) -> list[dict[str, Any]]:
    return [
        run
        for run in list_runs(project_root)
        if run.get("work_id") == work_id
    ]


def _select_active_or_stale_run(runs: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    for run in runs:
        if str(run.get("status") or "") in ACTIVE_RUN_STATUSES:
            return run
    return None


def get_active_run_for_work_item(project_root: Path, work_id: str) -> Optional[dict[str, Any]]:
    work_runs = get_work_item_runs(project_root, work_id)
    return _select_active_or_stale_run(work_runs)


def get_latest_run_for_work_item(project_root: Path, work_id: str) -> Optional[dict[str, Any]]:
    work_runs = get_work_item_runs(project_root, work_id)
    return work_runs[0] if work_runs else None


def get_work_item_runtime_summary(project_root: Path, work_id: str) -> dict[str, Any]:
    work_runs = get_work_item_runs(project_root, work_id)
    return {
        "active_run": _select_active_or_stale_run(work_runs),
        "latest_run": work_runs[0] if work_runs else None,
        "run_count": len(work_runs),
    }


def get_run_detail(project_root: Path, run_id: str) -> Optional[dict[str, Any]]:
    summary = next((run for run in list_runs(project_root) if run["run_id"] == run_id), None)
    if summary is None:
        return None
    run_dir = _runs_dir(project_root) / run_id
    return {
        **summary,
        "run": _read_json(run_dir / "run.json"),
        "state": _read_json(run_dir / "state.json"),
        "heartbeat": {"last_heartbeat_at": summary.get("last_heartbeat_at")},
        "artifacts": _read_json(run_dir / "artifacts.json"),
        "result": _read_json(run_dir / "result.json"),
        "phase_cards": get_run_phase_cards(project_root, run_id),
        "worker_logs": get_run_worker_logs(project_root, run_id, tail=4000),
    }


def _read_phase_artifact(project_root: Path, run_dir: Path, phase_state: dict[str, Any], phase: str) -> dict[str, Any]:
    artifacts = phase_state.get("artifacts") if isinstance(phase_state.get("artifacts"), dict) else {}
    candidate = artifacts.get(phase)
    path = Path(candidate) if isinstance(candidate, str) and candidate else run_dir / f"{phase}.json"
    if not path.is_absolute():
        path = project_root / path
    return _read_json(path)


def _latest_invalid_phase_error(project_root: Path, run_dir: Path, phase: str) -> dict[str, Any] | None:
    invalid_dir = run_dir / "worker-invalid"
    if not invalid_dir.is_dir():
        return None
    errors = sorted(invalid_dir.glob(f"{phase}.attempt-*.validation-error.txt"))
    if not errors:
        return None
    path = errors[-1]
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    return {
        "path": str(path.resolve().relative_to(project_root)),
        "summary": _short_text(text, limit=320),
    }


def _plan_sections(payload: dict[str, Any]) -> list[dict[str, Any]]:
    sections = [
        _body_section("Plan", payload.get("plan")),
        _section("Authority", [
            f"authority_complete={payload.get('authority_complete')}",
            f"open_gaps={len(payload.get('open_gaps') or []) if isinstance(payload.get('open_gaps'), list) else 0}",
            f"forbidden_assumptions={len(payload.get('forbidden_assumptions_used') or []) if isinstance(payload.get('forbidden_assumptions_used'), list) else 0}",
        ]),
        _section("Discovery tasks", _mixed_items(payload.get("discovery_tasks"))),
        _section("Execution steps", _mixed_items(payload.get("execution_steps"))),
        _section("Validation plan", [payload.get("validation_plan")]),
    ]
    return [section for section in sections if section]


def _execute_sections(payload: dict[str, Any]) -> list[dict[str, Any]]:
    receipt = payload.get("official_validation_receipt") if isinstance(payload.get("official_validation_receipt"), dict) else {}
    receipt_items: list[str] = []
    if receipt:
        receipt_items = [
            f"command={receipt.get('command') or ''}",
            f"python={receipt.get('python_executable') or ''}",
            f"cwd={receipt.get('cwd') or ''}",
            f"exit_code={receipt.get('exit_code')!r} passed={receipt.get('passed')!r}",
            f"stdout={receipt.get('stdout_log') or ''}",
            f"stderr={receipt.get('stderr_log') or ''}",
        ]
    sections = [
        _body_section("Report", payload.get("report")),
        _section("Official validation receipt", receipt_items, limit=8),
        _section("Plan deviations", _mixed_items(payload.get("plan_deviations"))),
        _section("Dependency actions", _mixed_items(payload.get("dependency_actions"))),
        _section("Debug attempts", _mixed_items(payload.get("debug_attempts"))),
        _section("Verification steps", _mixed_items(payload.get("verification_steps"))),
        _section("Resolved failures", _mixed_items(payload.get("resolved_failures"))),
        _section("Remaining failures", _mixed_items(payload.get("remaining_failures"))),
        _section("Files touched", _mixed_items(payload.get("files_touched"))),
        _section("Commands", _mixed_items(payload.get("commands_run"))),
        _section("Artifacts", _mixed_items(payload.get("artifacts"))),
    ]
    return [section for section in sections if section]


def _validate_sections(payload: dict[str, Any]) -> list[dict[str, Any]]:
    receipt = payload.get("official_validation_receipt") if isinstance(payload.get("official_validation_receipt"), dict) else {}
    observed = payload.get("observed_validation") if isinstance(payload.get("observed_validation"), dict) else {}
    metric = [
        f"{payload.get('metric_name') or 'metric'}={payload.get('metric_value')} threshold={payload.get('threshold')}",
        f"passed={payload.get('passed')}",
    ]
    runtime_contract = [
        f"runtime_contract_health={payload.get('runtime_contract_health') or ''}",
        f"failure_class={payload.get('failure_class') or ''}",
        f"acceptance_state={payload.get('acceptance_state') or ''}",
    ]
    observed_items: list[str] = []
    if observed:
        observed_items = [
            f"command={observed.get('command') or ''}",
            f"expected={observed.get('expected_command') or ''}",
            f"command_relation={observed.get('command_relation') or ''}",
            f"equivalence={observed.get('equivalence_rationale') or ''}",
            f"exit_code={observed.get('exit_code')!r} passed={observed.get('passed')!r}",
            f"command_matches={observed.get('command_matches')!r} metric_threshold_met={observed.get('metric_threshold_met')!r}",
            f"metric_value={observed.get('metric_value')!r}",
            f"drift={observed.get('validator_drift_reason') or ''}",
        ]
    receipt_items: list[str] = []
    if receipt:
        receipt_items = [
            f"command={receipt.get('command') or ''}",
            f"python={receipt.get('python_executable') or ''}",
            f"exit_code={receipt.get('exit_code')!r} passed={receipt.get('passed')!r}",
            f"stdout={receipt.get('stdout_log_path') or receipt.get('stdout_log') or ''}",
            f"stderr={receipt.get('stderr_log_path') or receipt.get('stderr_log') or ''}",
        ]
    check_items: list[str] = []
    checks = payload.get("checks")
    if isinstance(checks, list):
        for check in checks:
            if not isinstance(check, dict):
                check_items.append(_short_text(check))
                continue
            passed = check.get("ok") if isinstance(check.get("ok"), bool) else check.get("passed")
            blocking = check.get("blocking")
            status = "PASS" if passed is True else "INFO" if passed is False and blocking is False else "FAIL" if passed is False else "INFO"
            name = check.get("name") or "check"
            detail = check.get("detail") or check.get("details") or check.get("summary") or ""
            check_items.append(_short_text(f"{status} {name}: {detail}"))
    sections = [
        _section("Metric", metric),
        _section("Runtime contract", runtime_contract),
        _section("Observed validation", observed_items, limit=8),
        _section("Receipt", receipt_items, limit=8),
        _section("Checks", check_items, limit=12),
    ]
    return [section for section in sections if section]


def _reflect_sections(payload: dict[str, Any]) -> list[dict[str, Any]]:
    sections = [
        _body_section("Review", payload.get("review")),
        _section("Outcome", [
            f"outcome={payload.get('outcome')}",
            f"failure_class={payload.get('failure_class') or ''}",
            payload.get("root_cause") or "",
        ]),
        _section("Corrective feedback", [
            f"retry_authorized={payload.get('retry_authorized')}" if "retry_authorized" in payload else "",
            f"retry_target={payload.get('retry_target')}" if payload.get("retry_target") else "",
            payload.get("corrective_prompt") or "",
        ]),
        _section("Residual risks", _mixed_items(payload.get("residual_risks"))),
        _section("Evidence", _mixed_items(payload.get("evidence"))),
        _section("Next recommendation", [payload.get("next_recommendation"), payload.get("next_plan_hint")]),
    ]
    return [section for section in sections if section]


def _phase_sections(phase: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    if phase == "plan":
        return _plan_sections(payload)
    if phase == "execute":
        return _execute_sections(payload)
    if phase == "validate":
        return _validate_sections(payload)
    if phase == "reflect":
        return _reflect_sections(payload)
    return []


def get_run_phase_cards(project_root: Path, run_id: str) -> list[dict[str, Any]]:
    project_root = project_root.resolve()
    run_dir = _runs_dir(project_root) / run_id
    if not run_dir.is_dir():
        return []
    phase_state = _read_json(run_dir / "phase_state.json")
    state = _read_json(run_dir / "state.json")
    result = _read_json(run_dir / "result.json")
    phase_statuses = phase_state.get("phase_statuses") if isinstance(phase_state.get("phase_statuses"), dict) else {}
    cards: list[dict[str, Any]] = []
    for phase in RUN_PHASES:
        payload = _read_phase_artifact(project_root, run_dir, phase_state, phase)
        status = str(phase_statuses.get(phase) or "pending")
        if phase == state.get("phase") and state.get("status") in ACTIVE_RUN_STATUSES:
            status = str(state.get("status") or status)
        if not payload and phase == "reflect" and result.get("status") == "failed":
            invalid = _latest_invalid_phase_error(project_root, run_dir, phase)
            if invalid:
                payload = {
                    "summary": "Reflect output was invalid; dashboard is showing the archived validation diagnostic.",
                    "outcome": "failed",
                    "review": "Reflect output was invalid; dashboard is showing the archived validation diagnostic.",
                    "failure_class": "reflect_output_invalid",
                    "root_cause": invalid.get("summary"),
                    "corrective_prompt": "Use validate evidence as the acceptance source, then rerun after fixing the implementation issue.",
                    "_normalization_warnings": [{"field": "reflect", "reason": "invalid_output_diagnostic"}],
                    "_invalid_diagnostic_path": invalid.get("path"),
                }
                status = "failed"
        card = {
            "phase": phase,
            "label": phase.title(),
            "status": status,
            "summary": _short_text(payload.get("summary") if payload else "", limit=420),
            "warnings": _warning_items(payload.get("_normalization_warnings") if payload else []),
            "sections": _phase_sections(phase, payload) if payload else [],
        }
        if phase == "reflect":
            feedback = phase_state.get("reflect_feedback") if isinstance(phase_state.get("reflect_feedback"), dict) else {}
            attempts = feedback.get("attempts") if isinstance(feedback.get("attempts"), list) else []
            if attempts:
                card["retry_attempts"] = attempts
                retry_section = _section(
                    "Reflect feedback retries",
                    [
                        f"retry-{item.get('retry_index')}: guidance={item.get('guidance_id')} failure_class={item.get('failure_class')}"
                        for item in attempts
                        if isinstance(item, dict)
                    ],
                )
                if retry_section:
                    card["sections"].append(retry_section)
        cards.append(card)
    return cards


def get_run_events(project_root: Path, run_id: str, *, after_seq: Optional[int] = None, limit: int = 100) -> Optional[dict[str, Any]]:
    run_dir = _runs_dir(project_root) / run_id
    if not run_dir.is_dir():
        return None
    events = [_normalize_event(event) for event in _read_jsonl(run_dir / "events.jsonl")]
    events.sort(key=lambda item: item["seq"])
    if after_seq is not None:
        filtered = [event for event in events if event["seq"] > after_seq]
        payload = filtered[:limit]
        has_more = len(filtered) > len(payload)
    else:
        payload = events[-limit:]
        has_more = len(events) > len(payload)
    return {
        "run_id": run_id,
        "events": payload,
        "next_after_seq": payload[-1]["seq"] if payload else after_seq,
        "has_more": has_more,
    }


def get_run_worker_logs(project_root: Path, run_id: str, *, phase: Optional[str] = None, tail: int = 20000) -> Optional[dict[str, Any]]:
    project_root = project_root.resolve()
    run_dir = _runs_dir(project_root) / run_id
    if not run_dir.is_dir():
        return None
    log_dir = run_dir / "worker-logs"
    tail_limit = max(1000, min(int(tail), 200000))
    phases: list[str] = []
    if isinstance(phase, str) and phase.strip():
        phases = [phase.strip()]
    elif log_dir.is_dir():
        discovered = {
            path.name.rsplit(".", 2)[0]
            for path in log_dir.glob("*.log")
            if path.name.endswith((".stdout.log", ".stderr.log"))
        }
        phases = sorted(discovered)
    payload: dict[str, Any] = {"run_id": run_id, "tail": tail_limit, "logs": {}}
    for phase_name in phases:
        stdout_path = log_dir / f"{phase_name}.stdout.log"
        stderr_path = log_dir / f"{phase_name}.stderr.log"
        payload["logs"][phase_name] = {
            "phase": phase_name,
            "stdout": _file_info(stdout_path, project_root, limit=tail_limit),
            "stderr": _file_info(stderr_path, project_root, limit=tail_limit),
        }
    state = _read_json(run_dir / "state.json")
    payload["current_phase"] = state.get("phase")
    payload["status"] = state.get("status")
    return payload


def runtime_overview(project_root: Path) -> dict[str, Any]:
    runs = list_runs(project_root)
    active_runs = [run for run in runs if run.get("is_active")]
    stale_runs = [run for run in runs if run.get("is_stale")]
    auto_controllers = _list_auto_controllers(project_root)
    active_auto = [row for row in auto_controllers if row.get("status") in {"queued", "running", "idle"}]
    return {
        "active_run_count": len(active_runs),
        "stale_run_count": len(stale_runs),
        "active_auto_count": len(active_auto),
        "active_runs": active_runs[:10],
        "active_auto_controllers": active_auto[:10],
        "last_runtime_update": runs[0].get("last_updated_at") if runs else None,
        "progress_source": "work_result_plus_run_ledger",
        "host_breakdown": sorted({run.get("host") for run in runs if run.get("host")}),
    }


def _list_auto_controllers(project_root: Path) -> list[dict[str, Any]]:
    controllers_dir = project_root / ".thoth" / "objects" / "controller"
    if not controllers_dir.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for path in sorted(controllers_dir.glob("*.json")):
        payload = _read_json(path)
        body = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        if body.get("controller_type") != "auto":
            continue
        cursor = body.get("cursor") if isinstance(body.get("cursor"), dict) else {}
        attempts = _auto_attempt_rows(body)
        rows.append(
            {
                "controller_id": payload.get("object_id") or path.stem,
                "status": payload.get("status"),
                "state": body.get("state"),
                "elapsed_seconds": body.get("elapsed_seconds"),
                "min_runtime_seconds": body.get("min_runtime_seconds"),
                "rounds_attempted": cursor.get("rounds_attempted"),
                "active_run_id": cursor.get("active_run_id"),
                "queue_count": len(body.get("queue")) if isinstance(body.get("queue"), list) else 0,
                "completed_count": len(body.get("completed_work_ids")) if isinstance(body.get("completed_work_ids"), list) else 0,
                "attempt_count": len(attempts),
                "failed_attempt_count": _auto_attempt_status_count(body, "failed"),
                "failed_count": _auto_attempt_status_count(body, "failed"),
                "updated_at": payload.get("updated_at"),
            }
        )
    rows.sort(key=lambda row: str(row.get("updated_at") or ""), reverse=True)
    return rows


def _auto_attempt_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    attempts = payload.get("attempts")
    if not isinstance(attempts, list):
        return []
    return [dict(item) for item in attempts if isinstance(item, dict)]


def _auto_attempt_status_count(payload: dict[str, Any], status: str) -> int:
    attempts = _auto_attempt_rows(payload)
    if attempts:
        return sum(1 for item in attempts if item.get("status") == status)
    if status == "failed":
        failed = payload.get("failed_work_ids")
        return len([item for item in failed if isinstance(item, str)]) if isinstance(failed, list) else 0
    if status == "completed":
        completed = payload.get("completed_work_ids")
        return len([item for item in completed if isinstance(item, str)]) if isinstance(completed, list) else 0
    return 0


def _tail_text(path: Path, *, limit: int) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    if len(text) <= limit:
        return text
    return text[-limit:]


def _file_info(path: Path, project_root: Path, *, limit: int) -> dict[str, Any]:
    exists = path.exists()
    stat = path.stat() if exists else None
    return {
        "path": str(path.resolve().relative_to(project_root)) if exists else None,
        "exists": exists,
        "size": stat.st_size if stat else 0,
        "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z") if stat else None,
        "tail": _tail_text(path, limit=limit) if exists else "",
    }
