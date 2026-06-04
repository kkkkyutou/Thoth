"""FastAPI application assembly for the generated Thoth dashboard."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request

from dashboard_context import (
    DASHBOARD_DIR,
    DIRECTIONS,
    PROJECT_ROOT,
    THOTH_RUNS_DIR,
    dashboard_dir,
    frontend_index_response,
    project_name,
)
from data_loader import invalidate_cache
from database import init_db
from routes_actions import router as actions_router
from routes_experiments import router as experiments_router
from routes_observe import router as observe_router
from routes_read import router as read_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dashboard")
logger.info("Thoth project root: %s", PROJECT_ROOT)

app = FastAPI(title=f"{project_name()} Dashboard", version="1.0.0")
init_db()

SPA_ENTRY_ROUTES = (
    "/cockpit",
    "/runs",
    "/work",
    "/metrics",
    "/extensions",
    "/plugins",
    "/overview",
    "/work-items",
    "/milestones",
    "/dag",
    "/timeline",
    "/todo",
    "/activity",
    "/system",
)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return frontend_index_response()


for _spa_route in SPA_ENTRY_ROUTES:
    app.add_api_route(_spa_route, index, methods=["GET"], response_class=HTMLResponse)

app.include_router(observe_router)
app.include_router(experiments_router)
app.include_router(read_router)
app.include_router(actions_router)

frontend_dist = dashboard_dir() / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DASHBOARD_PORT", "8501"))
    host = os.environ.get("DASHBOARD_HOST", "127.0.0.1")
    logger.info("Starting dashboard on %s:%d", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")
