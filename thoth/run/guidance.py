"""Run-local guidance inbox for initial prompts and live corrections."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from thoth.objects import utc_now

from .io import _append_jsonl, _read_json, _write_json
from .model import RunHandle

GUIDANCE_MESSAGE_LIMIT = 8000
GUIDANCE_TAIL_LIMIT = 12


def _clean_message(message: Any) -> str:
    text = str(message or "").strip()
    if len(text) <= GUIDANCE_MESSAGE_LIMIT:
        return text
    return text[: GUIDANCE_MESSAGE_LIMIT - 20].rstrip() + "\n...[truncated]"


def guidance_path(project_root: Path, run_id: str) -> Path:
    return RunHandle(project_root=project_root.resolve(), run_id=run_id).run_dir / "guidance.jsonl"


def guidance_state_path(project_root: Path, run_id: str) -> Path:
    return RunHandle(project_root=project_root.resolve(), run_id=run_id).run_dir / "guidance-state.json"


def append_run_guidance(
    project_root: Path,
    run_id: str,
    *,
    message: Any,
    source: str = "live_user",
    phase: str | None = None,
    interrupt_requested: bool = False,
    parent_run_id: str | None = None,
) -> dict[str, Any]:
    text = _clean_message(message)
    if not text:
        raise ValueError("guidance message is required")
    entry = {
        "guidance_id": f"guide-{uuid.uuid4().hex[:12]}",
        "created_at": utc_now(),
        "source": str(source or "live_user"),
        "phase": phase or None,
        "message": text,
        "interrupt_requested": bool(interrupt_requested),
        "parent_run_id": parent_run_id or None,
    }
    _append_jsonl(guidance_path(project_root, run_id), entry)
    return entry


def read_run_guidance(project_root: Path, run_id: str, *, limit: int | None = None) -> list[dict[str, Any]]:
    path = guidance_path(project_root, run_id)
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            rows.append(payload)
    if isinstance(limit, int) and limit > 0:
        return rows[-limit:]
    return rows


def guidance_context(project_root: Path, run_id: str, *, limit: int = GUIDANCE_TAIL_LIMIT) -> dict[str, Any]:
    path = guidance_path(project_root, run_id)
    entries = read_run_guidance(project_root, run_id, limit=limit)
    return {
        "inbox_path": str(path),
        "tail": entries,
        "has_guidance": bool(entries),
        "policy": {
            "semantics": "temporary execution guidance only; does not modify authority or validator",
            "read_points": [
                "phase start",
                "before key implementation choices",
                "after failures",
                "before focused validation reruns",
            ],
        },
    }


def _handled_interrupt_ids(project_root: Path, run_id: str) -> set[str]:
    state = _read_json(guidance_state_path(project_root, run_id))
    ids = state.get("handled_interrupt_ids")
    if not isinstance(ids, list):
        return set()
    return {item for item in ids if isinstance(item, str) and item}


def pending_interrupt_guidance(project_root: Path, run_id: str, *, phase: str | None = None) -> dict[str, Any] | None:
    handled = _handled_interrupt_ids(project_root, run_id)
    for entry in read_run_guidance(project_root, run_id):
        guidance_id = entry.get("guidance_id")
        if not isinstance(guidance_id, str) or guidance_id in handled:
            continue
        if entry.get("interrupt_requested") is not True:
            continue
        entry_phase = entry.get("phase")
        if isinstance(entry_phase, str) and entry_phase and phase and entry_phase != phase:
            continue
        return entry
    return None


def mark_interrupt_handled(project_root: Path, run_id: str, guidance_id: str) -> None:
    path = guidance_state_path(project_root, run_id)
    state = _read_json(path)
    ids = state.get("handled_interrupt_ids")
    rows = [item for item in ids if isinstance(item, str)] if isinstance(ids, list) else []
    if guidance_id not in rows:
        rows.append(guidance_id)
    state["handled_interrupt_ids"] = rows
    state["updated_at"] = utc_now()
    _write_json(path, state)
