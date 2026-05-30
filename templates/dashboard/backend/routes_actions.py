"""Dashboard write and trigger routes."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from starlette.requests import Request

from dashboard_context import error_response, exception_response, require_action_token
from database import get_conn
from trigger_runner import run_health_check, run_sync, run_validate, run_verify

router = APIRouter()


@router.post("/api/trigger/validate")
async def trigger_validate(request: Request):
    require_action_token(request)
    try:
        return await run_validate()
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/trigger/sync")
async def trigger_sync(request: Request):
    require_action_token(request)
    try:
        return await run_sync()
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/trigger/verify/{work_id}")
async def trigger_verify(work_id: str, request: Request):
    require_action_token(request)
    try:
        return await run_verify(work_id)
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/trigger/health-check")
async def trigger_health_check(request: Request):
    require_action_token(request)
    try:
        return await run_health_check()
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/research-events")
async def api_add_research_event(body: dict, request: Request):
    require_action_token(request)
    required = {"work_id", "work_title", "module", "direction", "verdict"}
    missing = required - set(body.keys())
    if missing:
        return error_response(400, "MissingFields", f"Missing: {missing}")
    try:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO research_events (work_id, work_title, module, direction, verdict, conclusion_text) VALUES (?,?,?,?,?,?)",
                (
                    body["work_id"],
                    body["work_title"],
                    body["module"],
                    body["direction"],
                    body["verdict"],
                    body.get("conclusion_text"),
                ),
            )
        return {"status": "ok"}
    except Exception as exc:
        return exception_response(exc)


@router.get("/api/todo")
async def api_todo_get():
    try:
        with get_conn() as conn:
            projects = conn.execute("SELECT id, name, created_at FROM todo_projects ORDER BY id").fetchall()
            tasks = conn.execute(
                "SELECT id, project_id, description, due_label, due_date, completed, completed_at, created_at "
                "FROM todo_tasks ORDER BY project_id, id"
            ).fetchall()
        tasks_by_project: dict[int, list] = {}
        for t in tasks:
            tasks_by_project.setdefault(t["project_id"], []).append(dict(t))
        return [
            {"id": p["id"], "name": p["name"], "created_at": p["created_at"], "tasks": tasks_by_project.get(p["id"], [])}
            for p in projects
        ]
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/todo/projects")
async def api_todo_add_project(body: dict, request: Request):
    require_action_token(request)
    name = (body.get("name") or "").strip()
    if not name:
        return error_response(400, "MissingName", "Project name is required")
    try:
        with get_conn() as conn:
            cur = conn.execute("INSERT INTO todo_projects (name) VALUES (?)", (name,))
            return {"id": cur.lastrowid, "name": name}
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/todo/tasks")
async def api_todo_add_task(body: dict, request: Request):
    require_action_token(request)
    description = (body.get("description") or "").strip()
    project_id = body.get("project_id")
    if not description or not project_id:
        return error_response(400, "MissingFields", "description and project_id required")
    try:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO todo_tasks (project_id, description, due_label, due_date) VALUES (?,?,?,?)",
                (project_id, description, body.get("due_label"), body.get("due_date")),
            )
            return {"id": cur.lastrowid, "project_id": project_id, "description": description}
    except Exception as exc:
        return exception_response(exc)


@router.patch("/api/todo/tasks/{task_id}")
async def api_todo_update(task_id: int, body: dict, request: Request):
    require_action_token(request)
    try:
        with get_conn() as conn:
            row = conn.execute("SELECT * FROM todo_tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
            if "completed" in body:
                completed = bool(body["completed"])
                now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if completed else None
                conn.execute("UPDATE todo_tasks SET completed=?, completed_at=? WHERE id=?", (1 if completed else 0, now, task_id))
            if "description" in body:
                conn.execute("UPDATE todo_tasks SET description=? WHERE id=?", (body["description"], task_id))
            if "due_label" in body or "due_date" in body:
                conn.execute(
                    "UPDATE todo_tasks SET due_label=?, due_date=? WHERE id=?",
                    (body.get("due_label"), body.get("due_date"), task_id),
                )
        return {"id": task_id, "updated": True}
    except HTTPException:
        raise
    except Exception as exc:
        return exception_response(exc)
