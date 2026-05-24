"""Adversarial discussion runtime for `$thoth argue`."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from thoth.objects import Store, WORK_PAYLOAD_FIELDS, slugify, utc_now, work_item_ready_errors
from thoth.run.io import _write_json
from thoth.run.ledger import _append_event, _update_run, _update_state, _write_heartbeat, complete_run, fail_run, heartbeat_run, record_artifact
from thoth.run.model import LIVE_DISPATCH_MODE, RunHandle
from thoth.run.worker import _extract_json_object_from_text, _run_phase_worker_process, external_worker_command


DECISION_IMPACTS = {
    "keep_current_direction",
    "revise_authority",
    "needs_user_decision",
    "reject_or_reframe_direction",
}
ARGUE_PATCH_FIELDS = {
    "goal",
    "context",
    "constraints",
    "acceptance_spec",
    "approach_notes",
    "missing_questions",
}
ARGUE_WORKER_TIMEOUT_SECONDS = 15 * 60


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _compact(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _text_blob(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return " ".join(_text_blob(item) for item in value.values())
    if isinstance(value, list):
        return " ".join(_text_blob(item) for item in value)
    return str(value) if value is not None else ""


def _candidate_row(kind: str, obj: dict[str, Any], score: int) -> dict[str, Any]:
    return {
        "target_kind": kind,
        "target_id": str(obj.get("object_id") or ""),
        "title": str(obj.get("title") or obj.get("object_id") or ""),
        "summary": str(obj.get("summary") or ""),
        "status": obj.get("status"),
        "score": score,
    }


def _find_target_candidates(store: Store, query: str) -> list[dict[str, Any]]:
    text = query.strip().lower()
    if not text:
        return []
    rows: list[dict[str, Any]] = []
    for kind in ("work_item", "decision"):
        for obj in store.list(kind):
            object_id = str(obj.get("object_id") or "")
            haystack = " ".join(
                [
                    object_id,
                    str(obj.get("title") or ""),
                    str(obj.get("summary") or ""),
                    _text_blob(obj.get("payload")),
                ]
            ).lower()
            score = 0
            if text == object_id.lower():
                score = 100
            elif text in {str(obj.get("title") or "").lower(), str(obj.get("summary") or "").lower()}:
                score = 80
            elif text in haystack:
                score = 40
            else:
                tokens = [token for token in re.split(r"\s+", text) if len(token) >= 2]
                hits = sum(1 for token in tokens if token in haystack)
                if hits and hits == len(tokens):
                    score = 20 + hits
            if score:
                rows.append(_candidate_row(kind, obj, score))
    return sorted(rows, key=lambda row: (-int(row["score"]), str(row["target_kind"]), str(row["target_id"])))


def resolve_argue_target(
    project_root: Path,
    *,
    query: str,
    work_id: str | None = None,
    decision_id: str | None = None,
    target_kind: str | None = None,
    target_id: str | None = None,
) -> dict[str, Any]:
    store = Store(project_root)
    if work_id:
        obj = store.read("work_item", work_id)
        if not obj:
            return {"status": "needs_input", "reason": f"work_item not found: {work_id}", "candidates": []}
        return {"status": "resolved", "target": _target_from_object(project_root, "work_item", obj, query=query)}
    if decision_id:
        obj = store.read("decision", decision_id)
        if not obj:
            return {"status": "needs_input", "reason": f"decision not found: {decision_id}", "candidates": []}
        return {"status": "resolved", "target": _target_from_object(project_root, "decision", obj, query=query)}
    if target_kind:
        if target_kind == "idea":
            text = query or str(target_id or "").strip()
            if not text:
                return {"status": "needs_input", "reason": "idea target requires natural text", "candidates": []}
            return {"status": "resolved", "target": _idea_target(text)}
        if not target_id:
            return {"status": "needs_input", "reason": "--target-id is required with --target-kind", "candidates": []}
        obj = store.read(target_kind, target_id)
        if not obj:
            return {"status": "needs_input", "reason": f"{target_kind} not found: {target_id}", "candidates": []}
        return {"status": "resolved", "target": _target_from_object(project_root, target_kind, obj, query=query)}
    candidates = _find_target_candidates(store, query)
    if len(candidates) == 1:
        row = candidates[0]
        kind = str(row["target_kind"])
        obj = store.read(kind, str(row["target_id"]))
        return {"status": "resolved", "target": _target_from_object(project_root, kind, obj, query=query), "candidates": candidates}
    if len(candidates) > 1:
        best_score = int(candidates[0].get("score") or 0)
        tied = [row for row in candidates if int(row.get("score") or 0) == best_score]
        if len(tied) == 1 and best_score >= 80:
            row = tied[0]
            kind = str(row["target_kind"])
            obj = store.read(kind, str(row["target_id"]))
            return {"status": "resolved", "target": _target_from_object(project_root, kind, obj, query=query), "candidates": candidates}
        return {
            "status": "needs_input",
            "reason": "multiple plausible argue targets; choose one explicitly",
            "candidates": candidates[:8],
        }
    return {"status": "resolved", "target": _idea_target(query)}


def _target_from_object(project_root: Path, kind: str, obj: dict[str, Any], *, query: str) -> dict[str, Any]:
    object_id = str(obj.get("object_id") or "")
    return {
        "target_kind": kind,
        "target_id": object_id,
        "query": query,
        "title": str(obj.get("title") or object_id),
        "summary": str(obj.get("summary") or ""),
        "object_path": str(project_root / ".thoth" / "objects" / kind / f"{object_id}.json"),
    }


def _idea_target(text: str) -> dict[str, Any]:
    return {
        "target_kind": "idea",
        "target_id": None,
        "query": text,
        "title": text.strip()[:80] or "free idea",
        "summary": text.strip(),
        "object_path": None,
    }


def _target_ref(target: dict[str, Any]) -> str | None:
    kind = target.get("target_kind")
    target_id = target.get("target_id")
    if kind in {"work_item", "decision", "discussion"} and isinstance(target_id, str) and target_id:
        return f"{kind}:{target_id}"
    return None


def _linked_objects(store: Store, obj: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for link in obj.get("links", []) if isinstance(obj.get("links"), list) else []:
        if not isinstance(link, dict):
            continue
        raw_target = link.get("target")
        if not isinstance(raw_target, str) or ":" not in raw_target:
            continue
        kind, object_id = raw_target.split(":", 1)
        if kind not in {"discussion", "decision", "work_item", "artifact"}:
            continue
        linked = store.read(kind, object_id)
        if linked:
            rows.append({"link_type": link.get("type"), "object": linked})
    return rows


def _path_candidates_from_text(text: str) -> list[str]:
    rows: list[str] = []
    patterns = [
        r"`([^`]+\.[A-Za-z0-9_./-]+)`",
        r"(?<![\w.-])([A-Za-z0-9_./-]+/[A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+)",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, text):
            candidate = str(match).strip().strip("'\"")
            if candidate and candidate not in rows:
                rows.append(candidate)
    return rows[:12]


def collect_argue_context(project_root: Path, target: dict[str, Any]) -> dict[str, Any]:
    store = Store(project_root)
    authority_objects: list[dict[str, Any]] = []
    target_kind = target.get("target_kind")
    target_id = target.get("target_id")
    target_obj: dict[str, Any] = {}
    if target_kind in {"work_item", "decision"} and isinstance(target_id, str):
        target_obj = store.read(str(target_kind), target_id)
        if target_obj:
            authority_objects.append({"role": "target", "object": target_obj})
            authority_objects.extend(_linked_objects(store, target_obj))
            for evidence in store.evidence(str(target_kind), target_id):
                authority_objects.append({"role": "evidence", "object": evidence})
    text_for_paths = " ".join([_text_blob(target), _text_blob(target_obj)])
    referenced_files: list[dict[str, Any]] = []
    for candidate in _path_candidates_from_text(text_for_paths):
        path = (project_root / candidate).resolve() if not Path(candidate).is_absolute() else Path(candidate)
        try:
            path.relative_to(project_root.resolve())
        except ValueError:
            continue
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        referenced_files.append(
            {
                "path": str(path.relative_to(project_root.resolve())),
                "truncated": len(content) > 20000,
                "content": content[:20000],
            }
        )
    return {
        "schema_version": 1,
        "generated_at": utc_now(),
        "project_root": str(project_root.resolve()),
        "target": target,
        "authority_objects": authority_objects,
        "referenced_files": referenced_files,
        "network_policy": "Use network only for volatile frontier facts. If not verified, mark uncertainty explicitly.",
    }


def _attack_prompt(context: dict[str, Any], output_path: Path) -> str:
    return f"""# Thoth Argue Attacker

1. Role
You are an independent frontier-domain attacker. Your job is to make the strongest honest case that the target direction is stale, locally optimal, underspecified, over-constrained, missing a better paradigm, or likely to fail.

2. Evidence
Use the target authority JSON, linked objects, and referenced repo files below. You may use web access only for volatile frontier facts; if you do not verify such facts, mark them as uncertain.

3. Reasoning Standard
Do not perform a mechanical checklist. Reason from first principles, current best practice, alternatives, hidden assumptions, resource realism, and acceptance consequences.

4. Output
Write exactly one JSON object to `{output_path}` and do not surround it with prose. Required shape:
{{
  "summary": "short attack summary",
  "expert_domain": "domain lens used",
  "attack_md": "full markdown attack memo",
  "attack_points": [
    {{
      "id": "A1",
      "claim": "what is wrong or risky",
      "first_principles_rationale": "why it matters",
      "evidence_refs": ["authority object, file, or uncertainty marker"],
      "frontier_check": "what would change if current frontier knowledge differs",
      "severity": "critical|major|minor",
      "better_direction": "stronger direction or reframing"
    }}
  ]
}}

5. Context
```json
{_json(context)}
```
"""


def _adjudication_prompt(context: dict[str, Any], attack: dict[str, Any], output_path: Path) -> str:
    return f"""# Thoth Argue Adjudicator

1. Role
You are an independent adjudicator, not the attacker and not the executor. Rule point-by-point from evidence and project authority.

2. Decision Impact
Choose exactly one decision_impact:
- keep_current_direction
- revise_authority
- needs_user_decision
- reject_or_reframe_direction

3. Authority Patch Boundary
If revision is justified, preview only compact work payload fields: goal, context, constraints, acceptance_spec, approach_notes, missing_questions. Do not patch scheduling or run_limits unless the user later explicitly asks.

4. Output
Write exactly one JSON object to `{output_path}` and do not surround it with prose. Required shape:
{{
  "summary": "short adjudication summary",
  "decision_impact": "keep_current_direction|revise_authority|needs_user_decision|reject_or_reframe_direction",
  "adjudication_md": "full markdown adjudication",
  "point_rulings": [
    {{
      "point_id": "A1",
      "ruling": "stands|partially_stands|answered|unsupported",
      "authority_action": "keep|revise_goal|add_constraint|revise_acceptance|add_approach_note|add_missing_question|needs_user_decision",
      "rationale": "evidence-based ruling",
      "evidence_refs": ["authority object, file, or uncertainty marker"]
    }}
  ],
  "authority_patch": {{}},
  "residual_risks": [],
  "user_questions": []
}}

5. Context
```json
{_json(context)}
```

6. Attack Output
```json
{_json(attack)}
```
"""


def _normalize_attack(payload: dict[str, Any]) -> dict[str, Any]:
    points = payload.get("attack_points") if isinstance(payload.get("attack_points"), list) else []
    normalized_points = [point for point in points if isinstance(point, dict)]
    attack_md = payload.get("attack_md")
    if not isinstance(attack_md, str) or not attack_md.strip():
        lines = ["# Attack", "", str(payload.get("summary") or "No attack summary.")]
        for point in normalized_points:
            lines.extend(["", f"## {point.get('id') or 'Point'}", str(point.get("claim") or "")])
        attack_md = "\n".join(lines)
    return {
        "summary": str(payload.get("summary") or "attack completed").strip(),
        "expert_domain": str(payload.get("expert_domain") or "general").strip(),
        "attack_md": attack_md,
        "attack_points": normalized_points,
    }


def _normalize_adjudication(payload: dict[str, Any]) -> dict[str, Any]:
    impact = str(payload.get("decision_impact") or "").strip()
    if impact not in DECISION_IMPACTS:
        impact = "needs_user_decision"
    rulings = payload.get("point_rulings") if isinstance(payload.get("point_rulings"), list) else []
    authority_patch = payload.get("authority_patch") if isinstance(payload.get("authority_patch"), dict) else {}
    adjudication_md = payload.get("adjudication_md")
    if not isinstance(adjudication_md, str) or not adjudication_md.strip():
        adjudication_md = "# Adjudication\n\n" + str(payload.get("summary") or "Adjudication completed.")
    return {
        "summary": str(payload.get("summary") or "adjudication completed").strip(),
        "decision_impact": impact,
        "adjudication_md": adjudication_md,
        "point_rulings": [row for row in rulings if isinstance(row, dict)],
        "authority_patch": authority_patch,
        "residual_risks": payload.get("residual_risks") if isinstance(payload.get("residual_risks"), list) else [],
        "user_questions": payload.get("user_questions") if isinstance(payload.get("user_questions"), list) else [],
    }


def _test_worker_payload(role: str, context: dict[str, Any]) -> dict[str, Any]:
    target = context.get("target") if isinstance(context.get("target"), dict) else {}
    if role == "attack":
        return {
            "summary": "Deterministic adversarial attack completed.",
            "expert_domain": "agent-project-runtime",
            "attack_md": "# Attack\n\nA1 argues the authority should name the strongest validation evidence instead of relying on vague intent.",
            "attack_points": [
                {
                    "id": "A1",
                    "claim": "The target may under-specify the evidence needed to avoid local-optimum work.",
                    "first_principles_rationale": "A strong agent needs a crisp target and acceptance evidence to choose a final architecture.",
                    "evidence_refs": [str(target.get("target_kind") or "idea")],
                    "frontier_check": "No volatile frontier lookup required for this deterministic probe.",
                    "severity": "major",
                    "better_direction": "Clarify approach_notes and validation evidence.",
                }
            ],
        }
    return {
        "summary": "Deterministic adjudication recommends a compact authority revision.",
        "decision_impact": "revise_authority",
        "adjudication_md": "# Adjudication\n\nA1 partially stands. Add one approach note preserving strong validation without changing scheduling.",
        "point_rulings": [
            {
                "point_id": "A1",
                "ruling": "partially_stands",
                "authority_action": "add_approach_note",
                "rationale": "The authority can remain intact while making the expected validation posture clearer.",
                "evidence_refs": [str(target.get("target_kind") or "idea")],
            }
        ],
        "authority_patch": {"approach_notes": ["Use adversarial discussion evidence to tighten validation before execution."]},
        "residual_risks": [],
        "user_questions": [],
    }


def _worker_ids_from_log(path: Path) -> dict[str, Any]:
    ids: dict[str, Any] = {}
    if not path.exists():
        return ids
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        for key in ("thread_id", "session_id", "run_id", "conversation_id"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip() and key not in ids:
                ids[key] = value.strip()
    return ids


def _run_worker(
    *,
    handle: RunHandle,
    role: str,
    executor: str,
    context: dict[str, Any],
    attack: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    output_path = handle.run_dir / f"{role}.worker-output.json"
    prompt_path = handle.run_dir / f"{role}-prompt.md"
    log_dir = handle.run_dir / "worker-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = log_dir / f"{role}.stdout.log"
    stderr_path = log_dir / f"{role}.stderr.log"
    prompt = _attack_prompt(context, output_path) if role == "attack" else _adjudication_prompt(context, attack or {}, output_path)
    prompt_path.write_text(prompt, encoding="utf-8")
    record_artifact(handle.project_root, handle.run_id, path=str(prompt_path), label=prompt_path.name, artifact_kind="prompt", metadata={"role": role})
    started_at = utc_now()
    monotonic_started = time.time()
    test_mode = os.environ.get("THOTH_TEST_ARGUE_WORKER_MODE", "").strip().lower()
    returncode = 0
    if test_mode:
        payload = _test_worker_payload(role, context)
        _write_json(output_path, payload)
        stdout_path.write_text(_compact({"test_mode": test_mode, "role": role}) + "\n", encoding="utf-8")
        stderr_path.write_text("", encoding="utf-8")
    else:
        env = dict(os.environ)
        repo_root = Path(__file__).resolve().parent.parent
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = str(repo_root) if not existing else f"{repo_root}:{existing}"
        env["THOTH_EXTERNAL_WORKER"] = "1"
        command = external_worker_command(executor, handle.project_root, prompt, phase="plan", output_path=output_path)
        returncode = _run_phase_worker_process(
            command,
            handle=handle,
            phase=f"argue_{role}",
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            env=env,
            timeout_seconds=ARGUE_WORKER_TIMEOUT_SECONDS,
        )
        if returncode != 0:
            raise RuntimeError(f"argue {role} worker failed: executor={executor} returncode={returncode}")
        if not output_path.exists():
            extracted = _extract_json_object_from_text(stdout_path.read_text(encoding="utf-8", errors="replace"))
            if extracted:
                _write_json(output_path, extracted)
    if not output_path.exists():
        raise RuntimeError(f"argue {role} worker did not write {output_path.name}")
    payload = _read_json(output_path)
    normalized = _normalize_attack(payload) if role == "attack" else _normalize_adjudication(payload)
    _write_json(output_path, normalized)
    record_artifact(handle.project_root, handle.run_id, path=str(output_path), label=output_path.name, artifact_kind="worker_output", metadata={"role": role})
    record_artifact(handle.project_root, handle.run_id, path=str(stdout_path), label=stdout_path.name, artifact_kind="log", metadata={"role": role})
    record_artifact(handle.project_root, handle.run_id, path=str(stderr_path), label=stderr_path.name, artifact_kind="log", metadata={"role": role})
    metadata = {
        "role": role,
        "executor": executor,
        "prompt_path": str(prompt_path),
        "output_path": str(output_path),
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
        "started_at": started_at,
        "finished_at": utc_now(),
        "duration_seconds": round(time.time() - monotonic_started, 3),
        "exit_status": "completed",
        "returncode": returncode,
        "worker_ids": _worker_ids_from_log(stdout_path),
    }
    return normalized, metadata


def _write_text_artifact(handle: RunHandle, path: Path, text: str, *, label: str, kind: str) -> None:
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    record_artifact(handle.project_root, handle.run_id, path=str(path), label=label, artifact_kind=kind)


def _filter_patch(patch: Any) -> dict[str, Any]:
    if not isinstance(patch, dict):
        return {}
    return {key: value for key, value in patch.items() if key in ARGUE_PATCH_FIELDS}


def _patch_preview(
    *,
    project_root: Path,
    target: dict[str, Any],
    adjudication: dict[str, Any],
) -> dict[str, Any]:
    patch = _filter_patch(adjudication.get("authority_patch"))
    target_ref = _target_ref(target)
    applyable = bool(patch and target.get("target_kind") == "work_item" and target.get("target_id"))
    apply_path = None
    if applyable:
        apply_path = "<authority-patch-preview.json>"
    return {
        "schema_version": 1,
        "target": target,
        "target_ref": target_ref,
        "decision_impact": adjudication.get("decision_impact"),
        "patch_allowed_fields": sorted(ARGUE_PATCH_FIELDS),
        "patch": patch,
        "applyable": applyable,
        "confirmation_required": bool(patch),
        "apply_command": f"thoth argue --apply-artifact {apply_path}" if apply_path else None,
        "notes": [
            "Default argue only records evidence.",
            "Applying a patch requires explicit user confirmation in a separate apply command.",
            "Decision targets are not overwritten; create a superseding decision through discuss when needed.",
        ],
        "project_root": str(project_root.resolve()),
    }


def _create_aggregate_artifact(project_root: Path, run_id: str, target: dict[str, Any], paths: dict[str, str]) -> None:
    links = [{"type": "produced_by", "target": f"run:{run_id}"}]
    target_ref = _target_ref(target)
    if target_ref:
        links.append({"type": "evidence_for", "target": target_ref})
    Store(project_root).upsert(
        kind="artifact",
        object_id=f"argument-{run_id}",
        status="available",
        title=f"Argument {run_id}",
        summary=f"Adversarial discussion for {target.get('title') or target.get('query') or run_id}",
        source="argue",
        links=links,
        payload={"run_id": run_id, "target": target, "paths": paths},
        history_summary="argument artifact recorded",
    )


def run_argue(
    project_root: Path,
    *,
    query: str,
    work_id: str | None,
    decision_id: str | None,
    target_kind: str | None,
    target_id: str | None,
    host: str,
    executor: str,
) -> dict[str, Any]:
    resolution = resolve_argue_target(
        project_root,
        query=query,
        work_id=work_id,
        decision_id=decision_id,
        target_kind=target_kind,
        target_id=target_id,
    )
    if resolution.get("status") != "resolved":
        return {
            "exit_code": 2,
            "status": "needs_input",
            "summary": "Argue target is ambiguous or missing; no worker was started.",
            "body": resolution,
            "refs": [],
            "checks": [{"name": "target_resolved", "ok": False, "detail": resolution.get("reason")}],
        }
    target = resolution["target"]
    bound_work_id = str(target.get("target_id") or "") if target.get("target_kind") == "work_item" else None
    title = f"Argue: {target.get('title') or query or 'idea'}"
    from thoth.run.ledger import create_run

    handle = create_run(
        project_root,
        kind="argue",
        title=title,
        work_id=bound_work_id,
        work_revision=None,
        host=host,
        executor=executor,
        durable=True,
        dispatch_mode=LIVE_DISPATCH_MODE,
        sleep_requested=False,
        target=str(target.get("query") or target.get("target_id") or target.get("title") or ""),
    )
    try:
        _update_state(handle, status="running", phase="attack", progress_pct=10, supervisor_state=LIVE_DISPATCH_MODE)
        _write_heartbeat(handle)
        _append_event(handle, "argue target resolved", kind="argue", payload={"target": target})
        context = collect_argue_context(project_root, target)
        context_path = handle.run_dir / "argue-context.json"
        _write_json(context_path, context)
        record_artifact(project_root, handle.run_id, path=str(context_path), label=context_path.name, artifact_kind="context")
        attack, attack_metadata = _run_worker(handle=handle, role="attack", executor=executor, context=context)
        _update_state(handle, phase="adjudication", progress_pct=55)
        heartbeat_run(project_root, handle.run_id, phase="adjudication", progress_pct=55, note="attack worker completed")
        adjudication, adjudication_metadata = _run_worker(handle=handle, role="adjudication", executor=executor, context=context, attack=attack)
        preview = _patch_preview(project_root=project_root, target=target, adjudication=adjudication)
        preview_path = handle.run_dir / "authority-patch-preview.json"
        _write_json(preview_path, preview)
        preview["apply_command"] = f"thoth argue --apply-artifact {preview_path}"
        _write_json(preview_path, preview)
        attack_path = handle.run_dir / "attack.md"
        adjudication_path = handle.run_dir / "adjudication.md"
        _write_text_artifact(handle, attack_path, str(attack.get("attack_md") or ""), label="attack.md", kind="argument")
        _write_text_artifact(handle, adjudication_path, str(adjudication.get("adjudication_md") or ""), label="adjudication.md", kind="argument")
        record_artifact(project_root, handle.run_id, path=str(preview_path), label=preview_path.name, artifact_kind="authority_patch_preview")
        metadata = {
            "schema_version": 1,
            "run_id": handle.run_id,
            "workers": [attack_metadata, adjudication_metadata],
        }
        metadata_path = handle.run_dir / "worker-metadata.json"
        _write_json(metadata_path, metadata)
        record_artifact(project_root, handle.run_id, path=str(metadata_path), label=metadata_path.name, artifact_kind="worker_metadata")
        argument = {
            "schema_version": 1,
            "kind": "argument",
            "run_id": handle.run_id,
            "target": target,
            "summary": adjudication.get("summary"),
            "decision_impact": adjudication.get("decision_impact"),
            "attack": attack,
            "adjudication": adjudication,
            "authority_patch_preview": preview,
            "artifacts": {
                "attack_md": str(attack_path),
                "adjudication_md": str(adjudication_path),
                "authority_patch_preview": str(preview_path),
                "worker_metadata": str(metadata_path),
            },
            "created_at": utc_now(),
        }
        argument_path = handle.run_dir / "argument.json"
        _write_json(argument_path, argument)
        record_artifact(project_root, handle.run_id, path=str(argument_path), label=argument_path.name, artifact_kind="argument")
        paths = {
            "argument": str(argument_path),
            "attack": str(attack_path),
            "adjudication": str(adjudication_path),
            "authority_patch_preview": str(preview_path),
            "worker_metadata": str(metadata_path),
        }
        _create_aggregate_artifact(project_root, handle.run_id, target, paths)
        complete_run(
            project_root,
            handle.run_id,
            summary=str(adjudication.get("summary") or "Argument completed."),
            result_payload={
                "decision_impact": adjudication.get("decision_impact"),
                "target": target,
                "authority_patch_preview": preview,
                "artifacts": paths,
            },
            checks=[
                {"name": "attack_worker_completed", "ok": True, "detail": executor},
                {"name": "adjudication_worker_completed", "ok": True, "detail": executor},
                {"name": "authority_mutated", "ok": False, "detail": "preview only"},
            ],
        )
        body = {
            "run_id": handle.run_id,
            "dispatch_mode": LIVE_DISPATCH_MODE,
            "target": target,
            "decision_impact": adjudication.get("decision_impact"),
            "summary": adjudication.get("summary"),
            "artifacts": paths,
            "authority_patch_preview": {
                "path": str(preview_path),
                "decision_impact": preview.get("decision_impact"),
                "patch": preview.get("patch"),
                "applyable": preview.get("applyable"),
                "confirmation_required": preview.get("confirmation_required"),
                "apply_command": preview.get("apply_command"),
            },
        }
        return {
            "exit_code": 0,
            "status": "ok",
            "summary": f"Argument completed: {adjudication.get('decision_impact')}",
            "body": body,
            "refs": list(paths.values()),
            "checks": [
                {"name": "target_resolved", "ok": True, "detail": str(target.get("target_kind"))},
                {"name": "two_independent_workers", "ok": True, "detail": "attack + adjudication"},
                {"name": "authority_mutated", "ok": False, "detail": "preview only"},
            ],
        }
    except Exception as exc:
        fail_run(
            project_root,
            handle.run_id,
            summary="Argue runtime failed.",
            reason=str(exc),
            result_payload={"target": target, "error": str(exc)},
        )
        return {
            "exit_code": 1,
            "status": "failed",
            "summary": f"Argue failed: {exc}",
            "body": {"run_id": handle.run_id, "target": target, "error": str(exc)},
            "refs": [str(handle.run_dir)],
            "checks": [{"name": "argue_completed", "ok": False, "detail": str(exc)}],
        }


def apply_argue_patch(project_root: Path, preview_path: Path, *, confirm: str) -> dict[str, Any]:
    path = preview_path if preview_path.is_absolute() else project_root / preview_path
    preview = _read_json(path)
    if not preview:
        return {
            "exit_code": 2,
            "status": "needs_input",
            "summary": "Authority patch preview was not found or was not valid JSON.",
            "body": {"preview_path": str(path)},
            "refs": [str(path)],
            "checks": [{"name": "preview_loaded", "ok": False}],
        }
    patch = _filter_patch(preview.get("patch"))
    target = preview.get("target") if isinstance(preview.get("target"), dict) else {}
    if confirm.strip().lower() not in {"yes", "apply", "confirmed"}:
        return {
            "exit_code": 2,
            "status": "needs_input",
            "summary": "Argue patch apply requires explicit confirmation.",
            "body": {
                "confirmation_required": True,
                "confirm_prompt": "Apply this authority patch to the compact work item payload?",
                "apply_command": f"thoth argue --apply-artifact {path} --confirm-apply yes",
                "preview": preview,
            },
            "refs": [str(path)],
            "checks": [{"name": "explicit_confirmation", "ok": False}],
        }
    if target.get("target_kind") != "work_item" or not isinstance(target.get("target_id"), str):
        return {
            "exit_code": 2,
            "status": "needs_input",
            "summary": "Only work_item argument patches can be applied directly.",
            "body": {"target": target, "preview": preview},
            "refs": [str(path)],
            "checks": [{"name": "applyable_target", "ok": False}],
        }
    work_id = str(target["target_id"])
    store = Store(project_root)
    current = store.read("work_item", work_id)
    if not current:
        return {
            "exit_code": 2,
            "status": "needs_input",
            "summary": f"Target work item no longer exists: {work_id}",
            "body": {"work_id": work_id, "preview": preview},
            "refs": [str(path)],
            "checks": [{"name": "target_exists", "ok": False}],
        }
    current_payload = dict(current.get("payload") if isinstance(current.get("payload"), dict) else {})
    next_payload = {key: current_payload.get(key) for key in WORK_PAYLOAD_FIELDS if key in current_payload}
    for field, value in patch.items():
        if field == "approach_notes":
            existing = current_payload.get("approach_notes") if isinstance(current_payload.get("approach_notes"), list) else []
            incoming = value if isinstance(value, list) else [str(value)]
            merged = [item for item in existing if isinstance(item, str)]
            for item in incoming:
                if isinstance(item, str) and item.strip() and item.strip() not in merged:
                    merged.append(item.strip())
            next_payload[field] = merged
        elif field in {"constraints", "missing_questions"}:
            next_payload[field] = [item for item in value if isinstance(item, str)] if isinstance(value, list) else []
        else:
            next_payload[field] = value
    ready_errors = work_item_ready_errors(next_payload)
    next_status = "blocked" if ready_errors else current.get("status")
    updated = store.update(
        "work_item",
        work_id,
        expected_revision=int(current.get("revision", 0)),
        updates={"payload": next_payload, "status": next_status},
        history_summary=f"applied argue patch from {path.name}",
        source="argue",
    )
    return {
        "exit_code": 0,
        "status": "ok",
        "summary": f"Applied argue patch to {work_id}.",
        "body": {
            "work_id": work_id,
            "updated_revision": updated.get("revision"),
            "status": updated.get("status"),
            "applied_fields": sorted(patch),
            "ready_errors": ready_errors,
        },
        "refs": [str(path), str(store.path("work_item", work_id))],
        "checks": [
            {"name": "explicit_confirmation", "ok": True},
            {"name": "compact_fields_only", "ok": set(patch).issubset(ARGUE_PATCH_FIELDS), "detail": ",".join(sorted(patch))},
        ],
    }


__all__ = [
    "apply_argue_patch",
    "collect_argue_context",
    "resolve_argue_target",
    "run_argue",
]
