"""Local action receipt ledger for dashboard and plugin operations."""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thoth.observe.read_model import quick_health
from thoth.run.service import attach_run, stop_run


ACTION_LEDGER_DIR = ".thoth/local/actions"
ACTION_TOKEN_DIR = ".thoth/local/dashboard"
ACTION_TOKEN_FILE = f"{ACTION_TOKEN_DIR}/action-token"
ACTION_TOKEN_HEADER = "X-Thoth-Action-Token"

OBSERVE_ACTIONS: tuple[dict[str, Any], ...] = (
    {
        "id": "refresh",
        "title": "Refresh Providers",
        "target_kind": "surface",
        "backend_state": "available",
        "description": "Refresh Dashboard/TUI providers without mutating authority.",
        "confirmation_required": False,
    },
    {
        "id": "attach",
        "title": "Attach Run",
        "target_kind": "run",
        "backend_state": "available",
        "description": "Read the selected run event tail.",
        "confirmation_required": False,
    },
    {
        "id": "watch",
        "title": "Watch Run",
        "target_kind": "run",
        "backend_state": "available",
        "description": "Watch the selected run briefly through the runtime ledger.",
        "confirmation_required": False,
    },
    {
        "id": "stop",
        "title": "Stop Run",
        "target_kind": "run",
        "backend_state": "available",
        "description": "Request stop for the selected durable run.",
        "confirmation_required": True,
    },
    {
        "id": "validate",
        "title": "Validate Project",
        "target_kind": "project",
        "backend_state": "available",
        "description": "Run the read-only doctor validator and record a local receipt.",
        "confirmation_required": True,
    },
    {
        "id": "sync",
        "title": "Sync Managed Layer",
        "target_kind": "project",
        "backend_state": "available",
        "description": "Run init --sync for managed Thoth templates and record a local receipt.",
        "confirmation_required": True,
    },
    {
        "id": "health-check",
        "title": "Health Check",
        "target_kind": "project",
        "backend_state": "available",
        "description": "Run a quick read-model health probe without mutating authority.",
        "confirmation_required": False,
    },
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def action_ledger_dir(project_root: Path) -> Path:
    return project_root / ACTION_LEDGER_DIR


def action_token_path(project_root: Path) -> Path:
    return project_root / ACTION_TOKEN_FILE


def ensure_action_token(project_root: Path) -> str:
    """Return the local dashboard action token, creating it if needed."""

    env_token = os.environ.get("THOTH_DASHBOARD_ACTION_TOKEN")
    if env_token and len(env_token.strip()) >= 24:
        return env_token.strip()
    path = action_token_path(project_root)
    try:
        existing = path.read_text(encoding="utf-8").strip()
    except OSError:
        existing = ""
    if len(existing) >= 24:
        return existing
    token = secrets.token_urlsafe(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return token


def validate_action_token(project_root: Path, token: str | None) -> bool:
    if not token:
        return False
    expected = ensure_action_token(project_root)
    return secrets.compare_digest(str(token).strip(), expected)


def action_catalog() -> list[dict[str, Any]]:
    return [dict(action) for action in OBSERVE_ACTIONS]


def _recommended_command(action_id: str, target_id: str | None) -> str:
    if action_id == "stop" and target_id:
        return f"thoth run --stop {target_id}"
    if action_id == "validate":
        return "thoth doctor --json"
    if action_id == "sync":
        return "thoth init --sync"
    return ""


def _receipt_id(action: str) -> str:
    safe_action = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in action.lower()).strip("-")
    safe_action = safe_action or "action"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"act-{stamp}-{safe_action}-{secrets.token_hex(3)}"


def record_action_receipt(
    project_root: Path,
    *,
    action: str,
    status: str,
    summary: str,
    request: dict[str, Any] | None = None,
    result: dict[str, Any] | None = None,
    artifacts: list[str] | None = None,
    actor: str = "thoth",
) -> dict[str, Any]:
    """Persist one local, non-portable receipt for a dashboard/plugin action."""

    root = action_ledger_dir(project_root)
    root.mkdir(parents=True, exist_ok=True)
    receipt_id = _receipt_id(action)
    safe_request = json.loads(json.dumps(request or {}, ensure_ascii=False, default=str))
    safe_result = json.loads(json.dumps(result or {}, ensure_ascii=False, default=str))
    receipt = {
        "schema_version": 1,
        "receipt_id": receipt_id,
        "created_at": utc_now(),
        "project_root": str(project_root.resolve()),
        "actor": actor,
        "action": action,
        "status": status,
        "summary": summary,
        "request": safe_request,
        "result": safe_result,
        "artifacts": artifacts or [],
    }
    path = root / f"{receipt_id}.json"
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (root / "receipts.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"receipt_id": receipt_id, "created_at": receipt["created_at"], "action": action, "status": status}, ensure_ascii=False) + "\n")
    receipt["path"] = str(path.relative_to(project_root))
    return receipt


def list_action_receipts(project_root: Path, *, limit: int = 50) -> list[dict[str, Any]]:
    root = action_ledger_dir(project_root)
    if not root.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for path in sorted(root.glob("act-*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            payload.setdefault("path", str(path.relative_to(project_root)))
            rows.append(payload)
        if len(rows) >= limit:
            break
    return rows


def action_receipt_summary(project_root: Path, *, limit: int = 8) -> dict[str, Any]:
    receipts = list_action_receipts(project_root, limit=limit)
    counts: dict[str, int] = {}
    for receipt in list_action_receipts(project_root, limit=500):
        action = str(receipt.get("action") or "unknown")
        status = str(receipt.get("status") or "unknown")
        key = f"{action}:{status}"
        counts[key] = counts.get(key, 0) + 1
    return {
        "schema_version": 1,
        "ledger_dir": ACTION_LEDGER_DIR,
        "receipt_count_sampled": sum(counts.values()),
        "status_counts": counts,
        "recent_receipts": [
            {
                "receipt_id": receipt.get("receipt_id"),
                "created_at": receipt.get("created_at"),
                "action": receipt.get("action"),
                "status": receipt.get("status"),
                "summary": receipt.get("summary"),
                "path": receipt.get("path"),
            }
            for receipt in receipts
        ],
    }


def run_observe_action(
    project_root: Path,
    action_id: str,
    *,
    target_id: str | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    started = time.perf_counter()
    action = next((item for item in OBSERVE_ACTIONS if item["id"] == action_id), None)
    if action is None:
        return {
            "schema_version": 1,
            "action_id": action_id,
            "status": "error",
            "summary": f"Unknown action: {action_id}",
            "target_id": target_id,
            "body": {},
            "duration_ms": round((time.perf_counter() - started) * 1000.0, 3),
        }
    if action.get("confirmation_required") and not confirmed:
        return {
            "schema_version": 1,
            "action_id": action_id,
            "status": "confirm_required",
            "summary": f"Confirm action {action_id}.",
            "target_id": target_id,
            "body": {"recommended_command": _recommended_command(action_id, target_id)},
            "duration_ms": round((time.perf_counter() - started) * 1000.0, 3),
        }
    if action.get("target_kind") == "run" and not target_id:
        return {
            "schema_version": 1,
            "action_id": action_id,
            "status": "needs_target",
            "summary": "Select a run before executing this action.",
            "target_id": target_id,
            "body": {},
            "duration_ms": round((time.perf_counter() - started) * 1000.0, 3),
        }
    status = "ok"
    body: dict[str, Any] = {}
    summary = f"Action {action_id} completed."
    try:
        if action_id == "refresh":
            body = {"message": "Provider refresh requested."}
        elif action_id == "attach":
            body = {"output": attach_run(project_root, str(target_id), watch=False)}
        elif action_id == "watch":
            body = {"output": attach_run(project_root, str(target_id), watch=True, timeout_seconds=3.0)}
        elif action_id == "stop":
            stop_run(project_root, str(target_id))
            body = {"output": f"Stop requested for {target_id}."}
        elif action_id == "validate":
            result = subprocess.run(
                [sys.executable, "-m", "thoth.cli", "doctor", "--json"],
                cwd=str(project_root),
                text=True,
                capture_output=True,
                timeout=120,
                check=False,
            )
            status = "ok" if result.returncode == 0 else "failed"
            summary = "Doctor validation completed."
            body = {
                "returncode": result.returncode,
                "stdout": result.stdout[-12000:],
                "stderr": result.stderr[-12000:],
            }
        elif action_id == "sync":
            result = subprocess.run(
                [sys.executable, "-m", "thoth.cli", "init", "--sync"],
                cwd=str(project_root),
                text=True,
                capture_output=True,
                timeout=180,
                check=False,
            )
            status = "ok" if result.returncode == 0 else "failed"
            summary = "Managed init sync completed."
            body = {
                "returncode": result.returncode,
                "stdout": result.stdout[-12000:],
                "stderr": result.stderr[-12000:],
            }
        elif action_id == "health-check":
            healthy, message = quick_health(project_root)
            status = "ok" if healthy else "failed"
            summary = message
            body = {"healthy": healthy, "message": message}
        else:
            status = "error"
            summary = f"Unhandled action: {action_id}"
    except Exception as exc:
        status = "error"
        summary = f"{type(exc).__name__}: {exc}"
        body = {"error": summary}
    receipt = record_action_receipt(
        project_root,
        action=f"observe.{action_id}",
        status=status,
        summary=summary,
        request={"action_id": action_id, "target_id": target_id, "confirmed": confirmed},
        result=body,
    )
    return {
        "schema_version": 1,
        "action_id": action_id,
        "status": status,
        "summary": summary,
        "target_id": target_id,
        "body": body,
        "receipt": receipt,
        "duration_ms": round((time.perf_counter() - started) * 1000.0, 3),
    }
