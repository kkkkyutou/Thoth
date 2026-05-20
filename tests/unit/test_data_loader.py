"""Tests for strict dashboard data loader."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "templates" / "dashboard" / "backend"))

from data_loader import (
    _read_directions_from_config,
    _safe_load_yaml,
    invalidate_cache,
    load_all_tasks,
    load_modules,
    load_project_config,
)
from thoth.objects import Store
from thoth.plan.store import upsert_work_result


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_project_object(tmp_path: Path, *, directions: list[dict] | None = None) -> None:
    Store(tmp_path).upsert(
        kind="project",
        object_id="project",
        status="active",
        title="Loader Demo",
        summary="strict",
        payload={
            "project": {
                "name": "Loader Demo",
                "description": "strict",
                "language": "zh",
                "directions": directions or [{"id": "frontend", "label_en": "Frontend"}],
                "phases": [{"id": "survey", "weight": 20}],
            },
            "dashboard": {"port": 8600, "theme": "warm-bear"},
            "runtime": {"authority": ".thoth/objects"},
            "hosts": {"codex": {"projection": "AGENTS.md"}},
        },
    )


def _write_work_item(tmp_path: Path, work_id: str = "task-1", *, status: str = "ready") -> None:
    Store(tmp_path).upsert(
        kind="work_item",
        object_id=work_id,
        status=status,
        title="Strict task",
        summary="Verify loader",
        payload={
            "work_kind": "execution",
            "runnable": True,
            "goal": "Verify loader",
            "context": "f1",
            "direction": "frontend",
            "module": "f1",
            "constraints": ["test"],
            "execution_plan": ["Inspect loader output."],
            "eval_contract": {
                "entrypoint": {"command": "true"},
                "primary_metric": {"name": "ok", "direction": "gte", "threshold": 1},
                "validate_output_schema": {"type": "object"},
            },
            "runtime_policy": {"loop": {"max_iterations": 1, "max_runtime_seconds": 60}},
            "decisions": ["DEC-test"],
            "missing_questions": [],
        },
    )


def test_safe_load_yaml_handles_valid_and_invalid(tmp_path):
    good = tmp_path / "good.yaml"
    good.write_text("id: ok\n", encoding="utf-8")
    bad = tmp_path / "bad.yaml"
    bad.write_text("{{not yaml", encoding="utf-8")
    assert _safe_load_yaml(good)["id"] == "ok"
    assert _safe_load_yaml(bad) is None


def test_directions_from_manifest(tmp_path):
    _write_project_object(
        tmp_path,
        directions=[
            {"id": "frontend", "label_en": "Frontend"},
            {"id": "backend", "label_en": "Backend"},
        ],
    )
    directions = _read_directions_from_config(tmp_path)
    assert directions == ("frontend", "backend")


def test_directions_fall_back_to_work_item_payload(tmp_path):
    _write_work_item(tmp_path)
    directions = _read_directions_from_config(tmp_path)
    assert directions == ("frontend",)


def test_load_all_tasks_attaches_work_results(tmp_path):
    invalidate_cache()
    _write_project_object(tmp_path)
    _write_work_item(tmp_path, status="validated")
    upsert_work_result(
        tmp_path,
        "task-1",
        {
            "source": "legacy_import",
            "usable": True,
            "meets_goal": True,
            "evidence_paths": ["reports/demo.md"],
            "metrics": {},
            "updated_at": "2026-04-24T00:00:00Z",
        },
    )
    tasks = load_all_tasks(tmp_path)
    assert tasks[0]["id"] == "task-1"
    assert tasks[0]["authority_status"] == "validated"
    assert tasks[0]["module"] == "f1"
    assert tasks[0]["direction"] == "frontend"
    assert tasks[0]["work_result"]["source"] == "legacy_import"


def test_load_modules_from_tasks(tmp_path):
    invalidate_cache()
    _write_work_item(tmp_path)
    modules = load_modules(tmp_path)
    assert modules[0]["id"] == "f1"
    assert modules[0]["direction"] == "frontend"


def test_load_project_config_uses_manifest(tmp_path):
    invalidate_cache()
    _write_project_object(tmp_path)
    config = load_project_config(tmp_path)
    assert config["project"]["name"] == "Loader Demo"
    assert config["research"]["directions"][0]["id"] == "frontend"
    assert config["dashboard"]["port"] == 8600
    assert config["runtime"]["authority"] == ".thoth/objects"
    assert config["hosts"]["codex"]["projection"] == "AGENTS.md"
