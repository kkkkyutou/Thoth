"""Static dashboard API/read-model contract checks."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from thoth.objects import Store, flatten_work_item
from thoth.plan.store import load_project_manifest


DASHBOARD_API_CONTRACT: dict[str, tuple[str, ...]] = {
    "api_config": ("project", "research", "dashboard", "runtime", "hosts"),
    "api_work_items": (
        "id",
        "work_id",
        "title",
        "authority_status",
        "module",
        "direction",
        "active_run",
        "latest_run",
        "run_count",
    ),
    "api_status": ("last_updated", "project_root", "work_item_count", "module_count", "runtime", "compiler"),
}


def _warning(check_id: str, detail: str, *, severity: str = "warning") -> dict[str, Any]:
    return {"id": check_id, "severity": severity, "ok": False, "detail": detail}


def _project_directions(project_root: Path) -> list[dict[str, Any]]:
    manifest = load_project_manifest(project_root)
    project = manifest.get("project") if isinstance(manifest.get("project"), dict) else {}
    directions = project.get("directions")
    if not isinstance(directions, list):
        return []
    return [item for item in directions if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")]


def dashboard_ready_warnings(project_root: Path) -> list[dict[str, Any]]:
    """Return non-fatal dashboard readiness warnings without writing authority."""

    warnings: list[dict[str, Any]] = []
    directions = _project_directions(project_root)
    if not directions:
        warnings.append(_warning("dashboard-project-directions", "project.directions is empty; dashboard filters will be weak"))

    degraded_work: list[str] = []
    for work in Store(project_root).list("work_item"):
        work_id = str(work.get("object_id") or "")
        payload = work.get("payload") if isinstance(work.get("payload"), dict) else {}
        module = payload.get("module")
        direction = payload.get("direction")
        if not isinstance(module, str) or not module.strip() or module == "strict":
            degraded_work.append(f"{work_id}:module={module or 'missing'}")
        if not isinstance(direction, str) or not direction.strip() or direction == "general":
            degraded_work.append(f"{work_id}:direction={direction or 'missing'}")
    if degraded_work:
        warnings.append(
            _warning(
                "dashboard-work-item-module-direction",
                "work items missing dashboard module/direction: " + "; ".join(degraded_work[:10]),
            )
        )

    fields_missing: list[str] = []
    for work in Store(project_root).list("work_item"):
        row = flatten_work_item(work)
        missing = [field for field in ("id", "work_id", "authority_status", "module", "direction") if field not in row]
        if missing:
            fields_missing.append(f"{work.get('object_id')}:{','.join(missing)}")
    if fields_missing:
        warnings.append(_warning("dashboard-work-item-read-model-fields", "; ".join(fields_missing[:10])))
    return warnings


def dashboard_static_contract_warnings(dashboard_dir: Path) -> list[dict[str, Any]]:
    """Check dashboard backend routes and frontend type names against the minimum contract."""

    warnings: list[dict[str, Any]] = []
    backend_app = dashboard_dir / "backend" / "app.py"
    frontend_types = dashboard_dir / "frontend" / "src" / "types" / "index.ts"
    backend_text = backend_app.read_text(encoding="utf-8") if backend_app.exists() else ""
    types_text = frontend_types.read_text(encoding="utf-8") if frontend_types.exists() else ""

    for route in ("/api/config", "/api/work-items", "/api/status"):
        if route not in backend_text:
            warnings.append(_warning("dashboard-api-route-contract", f"missing backend route {route}"))

    for field in DASHBOARD_API_CONTRACT["api_config"]:
        if field not in types_text:
            warnings.append(_warning("dashboard-config-type-contract", f"frontend ResearchConfig missing {field}"))
    for field in DASHBOARD_API_CONTRACT["api_work_items"]:
        if field not in types_text:
            warnings.append(_warning("dashboard-work-item-type-contract", f"frontend WorkItem missing {field}"))
    for field in DASHBOARD_API_CONTRACT["api_status"]:
        if field not in types_text:
            warnings.append(_warning("dashboard-status-type-contract", f"frontend SystemStatus missing {field}"))
    return warnings
