"""Read-only dashboard API routes."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from thoth.observe.read_model import derive_gantt_rows

from dashboard_context import (
    attach_runtime,
    build_tree,
    exception_response,
    hard_dependency_ids,
    log_exception,
    milestone_payload,
    overview_payload,
    progress_payload,
    project_config,
    project_root,
    system_status_payload,
    work_actionability,
    work_authority_status,
)
from data_loader import (
    load_all_tasks,
    load_compiler_state,
    load_decisions,
    load_modules,
    load_work_item_refs,
)
from database import get_conn
from progress_calculator import calculate_module_progress, calculate_task_progress, find_blocked_tasks, get_task_status
from runtime_loader import (
    get_active_run_for_work_item,
    get_run_detail,
    get_run_events,
    get_run_worker_logs,
    get_work_item_runs,
)

logger = logging.getLogger("dashboard")
router = APIRouter()


@router.get("/api/config")
async def api_config():
    try:
        return project_config()
    except Exception as exc:
        return exception_response(exc)


@router.get("/api/tree")
async def api_tree():
    try:
        return build_tree()
    except Exception as exc:
        log_exception(logger, "/api/tree", exc)
        return exception_response(exc)


@router.get("/api/overview-summary")
async def api_overview_summary():
    try:
        return overview_payload()
    except Exception as exc:
        log_exception(logger, "/api/overview-summary", exc)
        return exception_response(exc)


@router.get("/api/work-items")
async def api_work_items(
    status: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=10000),
    offset: int = Query(0, ge=0),
):
    try:
        tasks = load_all_tasks(project_root())
        blocked_ids = {t.get("id") or t.get("work_id") for t in find_blocked_tasks(tasks)}
        result = []
        for t in tasks:
            t_status = get_task_status(t)
            work_id = t.get("id") or t.get("work_id")
            if work_id in blocked_ids and t_status not in {"invalid", "failed"}:
                t_status = "blocked"
            if status and t_status != status:
                continue
            if module and t.get("module") != module:
                continue
            if direction and t.get("direction") != direction:
                continue
            result.append(
                {
                    **attach_runtime({k: v for k, v in t.items() if not k.startswith("_")}),
                    "computed_status": t_status,
                    "computed_progress": calculate_task_progress(t),
                }
            )
        total = len(result)
        return {"total": total, "offset": offset, "limit": limit, "work_items": result[offset : offset + limit]}
    except Exception as exc:
        log_exception(logger, "/api/work-items", exc)
        return exception_response(exc)


@router.get("/api/work-items/{work_id}")
async def api_work_item_detail(work_id: str):
    try:
        tasks = load_all_tasks(project_root())
        for t in tasks:
            if t.get("id") == work_id or t.get("work_id") == work_id:
                return {
                    **attach_runtime({k: v for k, v in t.items() if not k.startswith("_")}),
                    "computed_status": get_task_status(t),
                    "computed_progress": calculate_task_progress(t),
                }
        raise HTTPException(status_code=404, detail=f"Work item {work_id} not found")
    except HTTPException:
        raise
    except Exception as exc:
        return exception_response(exc)


@router.get("/api/dag")
async def api_dag():
    try:
        modules = load_modules(project_root())
        tasks = load_all_tasks(project_root())
        tasks_by_id = {
            str(t.get("id") or t.get("work_id") or ""): t
            for t in tasks
            if str(t.get("id") or t.get("work_id") or "")
        }
        downstream_by_id: dict[str, list[str]] = {work_id: [] for work_id in tasks_by_id}
        for task in tasks:
            tid = str(task.get("id", "") or task.get("work_id", ""))
            for dep_id in hard_dependency_ids(task):
                downstream_by_id.setdefault(dep_id, []).append(tid)
        tasks_by_module: dict[str, list[dict]] = {}
        for t in tasks:
            tasks_by_module.setdefault(t.get("module", ""), []).append(t)
        nodes = []
        edges = []
        for mod in modules:
            mid = mod.get("id", "")
            mod_tasks = tasks_by_module.get(mid, [])
            nodes.append(
                {
                    "id": mid,
                    "label": mod.get("name", mid),
                    "type": "module",
                    "direction": mod.get("direction", ""),
                    "progress": calculate_module_progress(mod_tasks),
                    "work_item_count": len(mod_tasks),
                }
            )
            for ds in mod.get("related_modules", {}).get("downstream", []):
                edges.append({"source": mid, "target": ds, "type": "hard", "level": "module"})
        for task in tasks:
            tid = task.get("id", "") or task.get("work_id", "")
            actionability, waiting_on = work_actionability(task, tasks_by_id)
            nodes.append(
                {
                    "id": tid,
                    "label": task.get("title", tid),
                    "type": "work_item",
                    "direction": task.get("direction", ""),
                    "module": task.get("module", ""),
                    "status": get_task_status(task),
                    "progress": calculate_task_progress(task),
                    "authority_status": work_authority_status(task),
                    "actionability": actionability,
                    "waiting_on": waiting_on,
                    "downstream": sorted(item for item in downstream_by_id.get(tid, []) if item),
                    "goal": task.get("goal_statement", ""),
                    "acceptance": task.get("acceptance_spec", {}),
                }
            )
            for dep in task.get("depends_on", []):
                source = dep.get("work_id", "")
                if source:
                    edges.append(
                        {
                            "source": source,
                            "target": tid,
                            "type": dep.get("type", "soft"),
                            "level": "work_item",
                            "reason": dep.get("reason", ""),
                        }
                    )
        return {"nodes": nodes, "edges": edges}
    except Exception as exc:
        log_exception(logger, "/api/dag", exc)
        return exception_response(exc)


@router.get("/api/timeline")
async def api_timeline():
    try:
        gantt_rows = derive_gantt_rows(load_all_tasks(project_root()))
        return [
            {
                "id": row["id"],
                "title": row["title"],
                "module": row["module"],
                "direction": row["direction"],
                "status": row["status"],
                "progress": row["progress"],
                "start_date": row["start_date"],
                "end_date": row["end_date"],
                "estimated_hours": row["estimated_hours"],
                "spent_hours": 0,
            }
            for row in gantt_rows
        ]
    except Exception as exc:
        log_exception(logger, "/api/timeline", exc)
        return exception_response(exc)


@router.get("/api/gantt")
async def api_gantt():
    try:
        return derive_gantt_rows(load_all_tasks(project_root()))
    except Exception as exc:
        log_exception(logger, "/api/gantt", exc)
        return exception_response(exc)


@router.get("/api/progress")
async def api_progress():
    try:
        return progress_payload()
    except Exception as exc:
        log_exception(logger, "/api/progress", exc)
        return exception_response(exc)


@router.get("/api/milestones")
async def api_milestones():
    try:
        return milestone_payload()
    except Exception as exc:
        log_exception(logger, "/api/milestones", exc)
        return exception_response(exc)


@router.get("/api/activity")
async def api_activity(limit: int = Query(20, ge=1, le=100)):
    try:
        with get_conn() as conn:
            events = conn.execute(
                "SELECT id, work_id, work_title, module, direction, verdict, conclusion_text, created_at "
                "FROM research_events ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in events]
    except Exception as exc:
        log_exception(logger, "/api/activity", exc)
        return exception_response(exc)


@router.get("/api/status")
async def api_system_status():
    try:
        return system_status_payload()
    except Exception as exc:
        return exception_response(exc)


@router.get("/api/work-items/{work_id}/active-run")
async def api_work_item_active_run(work_id: str):
    try:
        return get_active_run_for_work_item(project_root(), work_id)
    except Exception as exc:
        log_exception(logger, f"/api/work-items/{work_id}/active-run", exc)
        return exception_response(exc)


@router.get("/api/work-items/{work_id}/runs")
async def api_work_item_runs(work_id: str):
    try:
        return {"work_id": work_id, "runs": get_work_item_runs(project_root(), work_id)}
    except Exception as exc:
        log_exception(logger, f"/api/work-items/{work_id}/runs", exc)
        return exception_response(exc)


@router.get("/api/runs/{run_id}")
async def api_run_detail(run_id: str):
    try:
        detail = get_run_detail(project_root(), run_id)
        if detail is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        return detail
    except HTTPException:
        raise
    except Exception as exc:
        log_exception(logger, f"/api/runs/{run_id}", exc)
        return exception_response(exc)


@router.get("/api/runs/{run_id}/events")
async def api_run_events(run_id: str, after_seq: Optional[int] = Query(None), limit: int = Query(100, ge=1, le=1000)):
    try:
        payload = get_run_events(project_root(), run_id, after_seq=after_seq, limit=limit)
        if payload is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        log_exception(logger, f"/api/runs/{run_id}/events", exc)
        return exception_response(exc)


@router.get("/api/runs/{run_id}/worker-logs")
async def api_run_worker_logs(run_id: str, phase: Optional[str] = Query(None), tail: int = Query(20000, ge=1000, le=200000)):
    try:
        payload = get_run_worker_logs(project_root(), run_id, phase=phase, tail=tail)
        if payload is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        log_exception(logger, f"/api/runs/{run_id}/worker-logs", exc)
        return exception_response(exc)


@router.get("/api/decisions")
async def api_decisions():
    try:
        return {"decisions": load_decisions(project_root())}
    except Exception as exc:
        log_exception(logger, "/api/decisions", exc)
        return exception_response(exc)


@router.get("/api/work-item-refs")
async def api_work_item_refs():
    try:
        return {"work_items": load_work_item_refs(project_root())}
    except Exception as exc:
        log_exception(logger, "/api/work-item-refs", exc)
        return exception_response(exc)


@router.get("/api/compiler-state")
async def api_compiler_state():
    try:
        return load_compiler_state(project_root())
    except Exception as exc:
        log_exception(logger, "/api/compiler-state", exc)
        return exception_response(exc)
