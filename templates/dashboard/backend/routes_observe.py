"""Observe, debug, and invalidation routes."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from starlette.requests import Request

from thoth.observe.actions import ACTION_TOKEN_HEADER, ensure_action_token
from thoth.observe.debug import debug_summary
from thoth.observe.extensions import extension_summary, tool_plugins
from thoth.observe.invalidation import delta_since, sse_event
from thoth.observe.providers import observe_snapshot
from thoth.observe.read_model_index import build_read_model_index

from dashboard_context import exception_response, log_exception, project_root, require_action_token

logger = logging.getLogger("dashboard")
router = APIRouter()


@router.get("/api/action-token")
async def api_action_token():
    try:
        return {
            "schema_version": 1,
            "header": ACTION_TOKEN_HEADER,
            "token": ensure_action_token(project_root()),
            "scope": "local-dashboard-actions",
        }
    except Exception as exc:
        log_exception(logger, "/api/action-token", exc)
        return exception_response(exc)


@router.get("/api/observe")
async def api_observe():
    try:
        return observe_snapshot(project_root())
    except Exception as exc:
        log_exception(logger, "/api/observe", exc)
        return exception_response(exc)


@router.get("/api/delta")
async def api_delta(cursor: Optional[str] = Query(None), limit: int = Query(200, ge=1, le=1000)):
    try:
        return delta_since(project_root(), cursor=cursor, limit=limit)
    except Exception as exc:
        log_exception(logger, "/api/delta", exc)
        return exception_response(exc)


@router.get("/api/invalidation/stream")
async def api_invalidation_stream(
    request: Request,
    cursor: Optional[str] = Query(None),
    poll_seconds: float = Query(2.0, ge=0.2, le=60.0),
    once: bool = Query(False),
):
    async def events():
        current = cursor
        while True:
            payload = delta_since(project_root(), cursor=current, limit=100)
            current = payload.get("cursor")
            yield sse_event(payload)
            if once or await request.is_disconnected():
                break
            await asyncio.sleep(poll_seconds)

    return StreamingResponse(events(), media_type="text/event-stream")


@router.get("/api/plugins")
async def api_plugins():
    try:
        return extension_summary(project_root())
    except Exception as exc:
        log_exception(logger, "/api/plugins", exc)
        return exception_response(exc)


@router.get("/api/debug/summary")
async def api_debug_summary():
    try:
        return debug_summary(project_root())
    except Exception as exc:
        log_exception(logger, "/api/debug/summary", exc)
        return exception_response(exc)


@router.post("/api/read-model/index")
async def api_read_model_index(request: Request):
    require_action_token(request)
    try:
        return build_read_model_index(project_root())
    except Exception as exc:
        log_exception(logger, "/api/read-model/index", exc)
        return exception_response(exc)


@router.get("/api/tools")
async def api_tools():
    try:
        tools = tool_plugins(project_root())
        return {"schema_version": 1, "tool_count": len(tools), "tools": tools}
    except Exception as exc:
        log_exception(logger, "/api/tools", exc)
        return exception_response(exc)


@router.get("/api/metrics")
async def api_metrics():
    try:
        return observe_snapshot(project_root())["providers"]["metrics"]
    except Exception as exc:
        log_exception(logger, "/api/metrics", exc)
        return exception_response(exc)
