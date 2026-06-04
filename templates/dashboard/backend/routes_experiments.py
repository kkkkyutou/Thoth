"""Experiment registry and channel routes."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Query
from starlette.requests import Request

from thoth.observe.experiments import (
    ExperimentError,
    ExperimentFilters,
    attach_source,
    detach_source,
    discover_experiments,
    experiment_detail,
    generic_channel_for_experiment,
    list_experiments,
    register_experiment,
    select_experiment,
    update_experiment,
    validate_experiments,
)

from dashboard_context import exception_response, log_exception, project_root, require_action_token

logger = logging.getLogger("dashboard")
router = APIRouter()


def _actor_from_request(request: Request) -> str:
    return request.headers.get("X-Thoth-Actor") or "dashboard"


def _error(exc: Exception):
    return {"schema_version": 1, "status": "failed", "error": f"{type(exc).__name__}: {exc}"}


@router.get("/api/experiments")
async def api_experiments(
    search: str = Query(""),
    status: str = Query(""),
    tag: str = Query(""),
    provider: str = Query(""),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    try:
        return list_experiments(project_root(), ExperimentFilters(search=search, status=status, tag=tag, provider=provider, limit=limit, offset=offset))
    except Exception as exc:
        log_exception(logger, "/api/experiments", exc)
        return exception_response(exc)


@router.get("/api/experiments/discover")
async def api_experiments_discover():
    try:
        return discover_experiments(project_root())
    except Exception as exc:
        log_exception(logger, "/api/experiments/discover", exc)
        return exception_response(exc)


@router.get("/api/experiments/validation")
async def api_experiments_validation():
    try:
        return validate_experiments(project_root())
    except Exception as exc:
        log_exception(logger, "/api/experiments/validation", exc)
        return exception_response(exc)


@router.get("/api/experiments/{experiment_id}")
async def api_experiment_detail(experiment_id: str):
    try:
        return experiment_detail(project_root(), experiment_id)
    except Exception as exc:
        log_exception(logger, f"/api/experiments/{experiment_id}", exc)
        return exception_response(exc)


@router.get("/api/experiments/{experiment_id}/channels/{channel}")
async def api_experiment_channel(experiment_id: str, channel: str):
    try:
        return generic_channel_for_experiment(project_root(), experiment_id, channel)
    except Exception as exc:
        log_exception(logger, f"/api/experiments/{experiment_id}/channels/{channel}", exc)
        return exception_response(exc)


@router.post("/api/experiments")
async def api_experiment_register(body: dict, request: Request):
    require_action_token(request)
    try:
        return register_experiment(project_root(), body, actor=_actor_from_request(request), source="dashboard", surface="dashboard", upsert=bool(body.get("upsert", False)))
    except (ExperimentError, ValueError) as exc:
        return _error(exc)
    except Exception as exc:
        return exception_response(exc)


@router.patch("/api/experiments/{experiment_id}")
async def api_experiment_update(experiment_id: str, body: dict, request: Request):
    require_action_token(request)
    try:
        return update_experiment(project_root(), experiment_id, body, actor=_actor_from_request(request), source="dashboard")
    except (ExperimentError, ValueError, FileNotFoundError) as exc:
        return _error(exc)
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/experiments/{experiment_id}/sources")
async def api_experiment_attach_source(experiment_id: str, body: dict, request: Request):
    require_action_token(request)
    try:
        return attach_source(project_root(), experiment_id, body, actor=_actor_from_request(request), source="dashboard")
    except (ExperimentError, ValueError, FileNotFoundError) as exc:
        return _error(exc)
    except Exception as exc:
        return exception_response(exc)


@router.delete("/api/experiments/{experiment_id}/sources/{source_id}")
async def api_experiment_detach_source(experiment_id: str, source_id: str, request: Request):
    require_action_token(request)
    try:
        return detach_source(project_root(), experiment_id, source_id, actor=_actor_from_request(request), source="dashboard")
    except (ExperimentError, ValueError, FileNotFoundError) as exc:
        return _error(exc)
    except Exception as exc:
        return exception_response(exc)


@router.post("/api/experiments/{experiment_id}/select")
async def api_experiment_select(experiment_id: str, request: Request, series: Optional[str] = Query(None)):
    require_action_token(request)
    try:
        return select_experiment(project_root(), experiment_id, series_id=series)
    except (ExperimentError, ValueError, FileNotFoundError) as exc:
        return _error(exc)
    except Exception as exc:
        return exception_response(exc)
