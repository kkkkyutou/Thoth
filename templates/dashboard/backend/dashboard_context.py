"""Shared helpers for the generated Thoth dashboard backend."""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.requests import Request

from thoth.observe.actions import ACTION_TOKEN_HEADER, validate_action_token
from thoth.observe.read_model import derive_gantt_rows, overview_summary_read_model

from data_loader import (
    DIRECTIONS,
    get_cache_info,
    load_all_tasks,
    load_compiler_state,
    load_modules,
    load_project_config,
)
from progress_calculator import (
    calculate_direction_progress,
    calculate_global_progress,
    calculate_module_progress,
    calculate_task_progress,
    estimate_completion,
    find_blocked_tasks,
    get_task_status,
    status_counts,
)
from runtime_loader import get_work_item_runtime_summary, runtime_overview

APP_DIR = Path(__file__).resolve().parent
DASHBOARD_DIR = APP_DIR.parent
PROJECT_ROOT = DASHBOARD_DIR / ".." / ".."
THOTH_RUNS_DIR = Path(
    os.environ.get("THOTH_RUNS_DIR", str(PROJECT_ROOT / ".thoth" / "runs"))
).resolve()


def _app_override(name: str, default: Any) -> Any:
    for module_name in ("app", "templates.dashboard.backend.app"):
        module = sys.modules.get(module_name)
        if module is not None and hasattr(module, name):
            return getattr(module, name)
    return default


def project_root() -> Path:
    return Path(_app_override("PROJECT_ROOT", PROJECT_ROOT))


def dashboard_dir() -> Path:
    return Path(_app_override("DASHBOARD_DIR", DASHBOARD_DIR))


def thoth_runs_dir() -> Path:
    return Path(_app_override("THOTH_RUNS_DIR", THOTH_RUNS_DIR))


def directions() -> tuple[str, ...]:
    value = _app_override("DIRECTIONS", DIRECTIONS)
    return tuple(value)


def project_config() -> dict[str, Any]:
    return load_project_config(project_root())


def project_name() -> str:
    return str(project_config().get("project", {}).get("name", "Thoth Project"))


def direction_labels() -> dict[str, str]:
    config_dirs = project_config().get("research", {}).get("directions") or []
    labels = {
        item["id"]: item.get("label_en", item["id"].title())
        for item in config_dirs
        if isinstance(item, dict) and item.get("id")
    }
    return labels or {direction: direction.title() for direction in directions()}


def error_response(status_code: int, error: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": error, "detail": detail})


def exception_response(exc: BaseException, *, error: str = "InternalError") -> JSONResponse:
    return error_response(500, error, str(exc))


def frontend_index_response() -> HTMLResponse:
    vue_index = dashboard_dir() / "frontend" / "dist" / "index.html"
    if vue_index.exists():
        return HTMLResponse(content=vue_index.read_text(encoding="utf-8"), status_code=200)
    return HTMLResponse(
        content=f"<h1>{project_name()} Dashboard</h1><p>Run: npm run build in tools/dashboard/frontend/</p>"
    )


def require_action_token(request: Request) -> None:
    token = request.headers.get(ACTION_TOKEN_HEADER)
    if not validate_action_token(project_root(), token):
        raise HTTPException(status_code=403, detail="Invalid or missing local dashboard action token")


def load_milestones() -> list[dict[str, Any]]:
    ms_path = (project_root() / ".agent-os" / "milestones.yaml").resolve()
    if ms_path.exists():
        import yaml as _yaml

        with open(ms_path, encoding="utf-8") as f:
            data = _yaml.safe_load(f) or {}
            return data.get("milestones", [])
    return []


def milestone_payload() -> list[dict[str, Any]]:
    milestone_map = load_milestones()
    work_items = load_all_tasks(project_root())
    work_items_by_id = {item.get("id", ""): item for item in work_items}
    result = []
    for ms in milestone_map:
        ms_work_item_ids = ms.get("work_items") or ms.get("tasks", [])
        ms_work_items = [work_items_by_id[wid] for wid in ms_work_item_ids if wid in work_items_by_id]
        progress = (
            sum(calculate_task_progress(t) for t in ms_work_items) / len(ms_work_items)
            if ms_work_items
            else 0.0
        )
        result.append(
            {
                "id": ms["id"],
                "name": ms["name"],
                "description": ms.get("description", ""),
                "progress": round(progress, 1),
                "work_item_count": len(ms_work_item_ids),
            }
        )
    return result


def summarize_phases(task: dict[str, Any]) -> dict[str, Any]:
    if "phases" not in task:
        return {}
    phases = task.get("phases", {})
    summary = {}
    for pname in ("survey", "method_design", "experiment", "conclusion"):
        p = phases.get(pname, {})
        if p:
            summary[pname] = {"status": p.get("status", "pending")}
            criteria = p.get("criteria")
            if criteria:
                summary[pname]["criteria"] = criteria
        else:
            summary[pname] = {"status": "pending"}
    return summary


def attach_runtime(work_item: dict[str, Any]) -> dict[str, Any]:
    payload = dict(work_item)
    work_id = str(work_item.get("work_id", "") or work_item.get("id", ""))
    payload.update(get_work_item_runtime_summary(project_root(), work_id))
    return payload


def work_authority_status(work_item: dict[str, Any]) -> str:
    return str(work_item.get("ready_state") or work_item.get("authority_status") or work_item.get("status") or "")


def hard_dependency_ids(work_item: dict[str, Any]) -> list[str]:
    rows: list[str] = []
    depends_on = work_item.get("depends_on") if isinstance(work_item.get("depends_on"), list) else []
    for dep in depends_on:
        if not isinstance(dep, dict):
            continue
        if dep.get("type", "hard") != "hard":
            continue
        dep_id = dep.get("work_id")
        if isinstance(dep_id, str) and dep_id:
            rows.append(dep_id)
    return rows


def work_actionability(work_item: dict[str, Any], tasks_by_id: dict[str, dict[str, Any]]) -> tuple[str, list[str]]:
    authority_status = work_authority_status(work_item)
    waiting_on = [
        dep_id
        for dep_id in hard_dependency_ids(work_item)
        if work_authority_status(tasks_by_id.get(dep_id, {})) != "validated"
    ]
    if authority_status == "ready" and waiting_on:
        return "waiting_on", waiting_on
    if authority_status == "ready":
        return "actionable", []
    if authority_status in {"blocked", "draft", "abandoned", "validated", "failed", "active"}:
        return authority_status, waiting_on
    return authority_status or "unknown", waiting_on


def build_tree() -> list[dict[str, Any]]:
    modules = load_modules(project_root())
    all_work_items = load_all_tasks(project_root())
    work_items_by_module: dict[str, list[dict[str, Any]]] = {}
    for t in all_work_items:
        work_items_by_module.setdefault(t.get("module", ""), []).append(t)
    modules_by_dir: dict[str, list[dict[str, Any]]] = {}
    for m in modules:
        modules_by_dir.setdefault(m.get("direction", "unknown"), []).append(m)

    labels = direction_labels()
    tree = []
    for direction in directions():
        dir_modules = modules_by_dir.get(direction, [])
        module_nodes = []
        for mod in dir_modules:
            mid = mod.get("id", "")
            mod_work_items = work_items_by_module.get(mid, [])
            work_item_nodes = []
            for work_item in mod_work_items:
                work_item_nodes.append(
                    {
                        "id": work_item.get("id", "") or work_item.get("work_id", ""),
                        "title": work_item.get("title", ""),
                        "type": "work_item",
                        "status": get_task_status(work_item),
                        "progress": calculate_task_progress(work_item),
                        "hypothesis": work_item.get("hypothesis") or work_item.get("goal_statement", ""),
                        "phases": summarize_phases(work_item),
                    }
                )
            module_nodes.append(
                {
                    "id": mid,
                    "name": mod.get("name", mid),
                    "scientific_question": mod.get("scientific_question", ""),
                    "work_item_count": len(mod_work_items),
                    "progress": calculate_module_progress(mod_work_items),
                    "work_items": work_item_nodes,
                    "upstream": mod.get("related_modules", {}).get("upstream", []),
                    "downstream": mod.get("related_modules", {}).get("downstream", []),
                }
            )
        dir_progress = calculate_direction_progress(
            [{"tasks": work_items_by_module.get(m.get("id", ""), [])} for m in dir_modules]
        )
        tree.append(
            {
                "direction": direction,
                "label": labels.get(direction, direction.title()),
                "module_count": len(dir_modules),
                "progress": dir_progress,
                "modules": module_nodes,
            }
        )
    return tree


def overview_payload() -> dict[str, Any]:
    tasks = load_all_tasks(project_root())
    runtime = runtime_overview(project_root())
    payload = overview_summary_read_model(project_root())
    payload["runtime"] = runtime
    payload["milestones"] = milestone_payload()
    payload["gantt_preview"] = derive_gantt_rows(tasks)[:6]
    return payload


def progress_payload() -> dict[str, Any]:
    tasks = load_all_tasks(project_root())
    modules = load_modules(project_root())
    compiler_state = load_compiler_state(project_root())
    counts = status_counts(tasks)
    overall_pct = calculate_global_progress(tasks)
    est = estimate_completion(tasks)
    tasks_by_dir: dict[str, list[dict[str, Any]]] = {}
    for t in tasks:
        tasks_by_dir.setdefault(t.get("direction", ""), []).append(t)
    by_direction = {}
    for direction in directions():
        dir_tasks = tasks_by_dir.get(direction, [])
        by_direction[direction] = calculate_global_progress(dir_tasks) if dir_tasks else 0.0

    blocked = find_blocked_tasks(tasks)
    blocked_list = []
    for bt in blocked:
        deps = [d.get("work_id", "") for d in bt.get("depends_on", []) if d.get("type") == "hard"]
        if bt.get("blocking_reason"):
            deps = [str(bt.get("blocking_reason"))]
        blocked_list.append({"id": bt.get("id", "") or bt.get("work_id", ""), "title": bt.get("title", ""), "blocked_by": deps})

    return {
        "overall_progress": overall_pct,
        "by_direction": by_direction,
        "status_counts": counts,
        "blocked_work_items": blocked_list,
        "module_count": len(modules),
        "estimation": est,
        "runtime": runtime_overview(project_root()),
        "compiler": compiler_state,
    }


def system_status_payload() -> dict[str, Any]:
    tasks = load_all_tasks(project_root())
    modules = load_modules(project_root())
    runtime = runtime_overview(project_root())
    return {
        "last_updated": runtime.get("last_runtime_update") or __import__("time").time(),
        "project_root": str(project_root().resolve()),
        "work_item_count": len(tasks),
        "module_count": len(modules),
        "cache_info": get_cache_info(),
        "runtime": runtime,
        "compiler": load_compiler_state(project_root()),
    }


def log_exception(logger: Any, endpoint: str, exc: BaseException) -> None:
    logger.error("Error in %s: %s", endpoint, traceback.format_exc())
