"""Tests for task-first runtime APIs backed by `.thoth/runs`."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from thoth.objects import Store
from thoth.observe.actions import record_action_receipt
from thoth.observe.experiments import register_experiment
from thoth.plan.store import upsert_work_item, upsert_decision, upsert_work_result

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "templates" / "dashboard" / "backend"))

import app as dashboard_app
import data_loader as dashboard_data_loader


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def _setup_project(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("THOTH_RUNS_DIR", str(tmp_path / ".thoth" / "runs"))
    monkeypatch.setenv("THOTH_HEARTBEAT_STALE_MINUTES", "100000")
    monkeypatch.setattr(dashboard_app, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(dashboard_app, "DASHBOARD_DIR", tmp_path / "tools" / "dashboard")
    monkeypatch.setattr(dashboard_app, "THOTH_RUNS_DIR", tmp_path / ".thoth" / "runs")
    monkeypatch.setattr(dashboard_app, "DIRECTIONS", ("frontend",))
    monkeypatch.setattr(dashboard_data_loader, "DIRECTIONS", ("frontend",))

    (tmp_path / ".agent-os").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".agent-os" / "milestones.yaml").write_text("milestones: []\n", encoding="utf-8")
    (tmp_path / "tools" / "dashboard" / "frontend" / "dist").mkdir(parents=True, exist_ok=True)
    (tmp_path / "tools" / "dashboard" / "frontend" / "dist" / "index.html").write_text(
        "<!doctype html><html><body><div id='app'>dashboard shell</div></body></html>",
        encoding="utf-8",
    )
    _write_json(
        tmp_path / ".thoth" / "objects" / "project" / "project.json",
        {
            "schema_version": 1,
            "object_id": "project",
            "kind": "project",
            "status": "active",
            "title": "RuntimeDemo",
            "summary": "Runtime dashboard test project",
            "revision": 1,
            "created_at": "2026-04-23T01:00:00Z",
            "updated_at": "2026-04-23T01:00:00Z",
            "source": "test",
            "links": [],
            "payload": {
                "project": {
                    "name": "RuntimeDemo",
                    "directions": [{"id": "frontend", "label_en": "Frontend"}],
                    "phases": [],
                },
                "dashboard": {"port": 8501},
            },
            "history": [],
        },
    )

    upsert_decision(
        tmp_path,
        {
            "schema_version": 1,
            "kind": "decision",
            "decision_id": "DEC-runtime",
            "question": "Which runtime binding should be tested?",
            "candidate_method_ids": ["real-process-lifecycle"],
            "selected_values": {"candidate_method_id": "real-process-lifecycle"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    upsert_work_item(
        tmp_path,
        {
            "work_id": "task-1",
            "title": "Long running task",
            "status": "ready",
            "goal": "Test runtime binding",
            "context": "frontend-runtime",
            "constraints": ["dashboard"],
            "acceptance_spec": {
                "kind": "script",
                "description": "Run pytest.",
                "metric": {"name": "checks", "direction": "gte", "threshold": 1},
                "reference_command": "pytest",
            },
            "approach_notes": ["Run lifecycle integration"],
            "run_limits": {"max_iterations": 10, "max_runtime_seconds": 28800},
            "scheduling": {"order": None},
            "decisions": ["DEC-runtime"],
            "missing_questions": [],
        },
    )

    runs_dir = tmp_path / ".thoth" / "runs"
    _write_json(runs_dir / "run-1" / "run.json", {"run_id": "run-1", "work_id": "task-1", "host": "codex", "executor": "claude", "attachable": True, "created_at": "2026-04-23T01:00:00Z"})
    _write_json(runs_dir / "run-1" / "state.json", {"status": "running", "phase": "experiment", "progress_pct": 61, "last_event_seq": 2, "updated_at": "2026-04-23T01:10:00Z", "supervisor_state": "running", "last_heartbeat_at": "2026-04-23T01:11:00Z"})
    _write_jsonl(runs_dir / "run-1" / "events.jsonl", [
        {"seq": 1, "ts": "2026-04-23T01:01:00Z", "kind": "log", "message": "started"},
        {"seq": 2, "ts": "2026-04-23T01:10:00Z", "kind": "log", "message": "still running"},
    ])
    (runs_dir / "run-1" / "worker-logs").mkdir(parents=True)
    (runs_dir / "run-1" / "worker-logs" / "plan.stdout.log").write_text("worker stdout latest line", encoding="utf-8")
    (runs_dir / "run-1" / "worker-logs" / "plan.stderr.log").write_text("worker stderr latest line", encoding="utf-8")
    _write_json(
        tmp_path / ".thoth" / "objects" / "controller" / "controller-auto-1.json",
        {
            "schema_version": 1,
            "object_id": "controller-auto-1",
            "kind": "controller",
            "status": "running",
            "title": "Auto queue controller",
            "summary": "Running auto",
            "revision": 1,
            "created_at": "2026-04-23T01:00:00Z",
            "updated_at": "2026-04-23T01:12:00Z",
            "source": "auto",
            "links": [],
            "payload": {
                "controller_type": "auto",
                "state": "running",
                "started_at": "2026-04-23T01:00:00Z",
                "min_runtime_seconds": 28800,
                "work_refs": [{"work_id": "task-1", "revision": 1}],
                "attempts": [],
                "cursor": {"rounds_attempted": 1, "active_run_id": "run-1"},
            },
            "history": [],
        },
    )


def test_work_item_endpoint_includes_active_run(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    response = client.get("/api/work-items")
    assert response.status_code == 200
    body = response.json()
    assert body["work_items"][0]["active_run"]["run_id"] == "run-1"
    assert body["work_items"][0]["latest_run"]["run_id"] == "run-1"
    assert body["work_items"][0]["run_count"] == 1
    assert body["work_items"][0]["active_run"]["host"] == "codex"
    assert body["work_items"][0]["active_run"]["attachable"] is True


def test_active_run_endpoint_does_not_return_terminal_latest_run(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    state_path = tmp_path / ".thoth" / "runs" / "run-1" / "state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({"status": "completed", "phase": "completed", "progress_pct": 100})
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    active = client.get("/api/work-items/task-1/active-run")
    assert active.status_code == 200
    assert active.json() is None

    detail = client.get("/api/work-items/task-1")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["active_run"] is None
    assert payload["latest_run"]["run_id"] == "run-1"
    assert payload["run_count"] == 1


def test_runtime_progress_and_event_endpoints(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    progress = client.get("/api/progress")
    assert progress.status_code == 200
    assert progress.json()["runtime"]["active_run_count"] == 1
    assert progress.json()["runtime"]["active_auto_count"] == 1
    assert progress.json()["runtime"]["active_auto_controllers"][0]["controller_id"] == "controller-auto-1"
    assert progress.json()["runtime"]["host_breakdown"] == ["codex"]

    active = client.get("/api/work-items/task-1/active-run")
    assert active.status_code == 200
    assert active.json()["status"] == "running"
    assert active.json()["supervisor_state"] == "running"

    history = client.get("/api/work-items/task-1/runs")
    assert history.status_code == 200
    assert history.json()["runs"][0]["run_id"] == "run-1"

    events = client.get("/api/runs/run-1/events?after_seq=1&limit=10")
    assert events.status_code == 200
    payload = events.json()
    assert payload["events"][0]["seq"] == 2
    assert payload["next_after_seq"] == 2

    detail = client.get("/api/runs/run-1")
    assert detail.status_code == 200
    assert detail.json()["worker_logs"]["logs"]["plan"]["stdout"]["tail"] == "worker stdout latest line"

    logs = client.get("/api/runs/run-1/worker-logs?phase=plan&tail=1000")
    assert logs.status_code == 200
    logs_payload = logs.json()
    assert logs_payload["run_id"] == "run-1"
    assert logs_payload["logs"]["plan"]["stdout"]["tail"] == "worker stdout latest line"
    assert logs_payload["logs"]["plan"]["stderr"]["tail"] == "worker stderr latest line"


def test_observe_plugin_tool_and_metrics_endpoints(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    manifest_path = tmp_path / ".thoth" / "extensions" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugins": [
                    {
                        "id": "metrics-demo",
                        "version": "1.0.0",
                        "enabled": True,
                        "surfaces": ["dashboard", "tui"],
                        "capabilities": ["metrics_provider"],
                        "source": ".thoth/extensions/plugins/metrics-demo",
                        "config": {
                            "run_name": "unit-demo",
                            "metrics_files": [".thoth/extensions/plugins/metrics-demo/metrics.jsonl"],
                        },
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    metrics_path = tmp_path / ".thoth" / "extensions" / "plugins" / "metrics-demo" / "metrics.jsonl"
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text(
        '{"step":1,"split":"train","metrics":{"loss_total":3.0}}\n'
        '{"step":2,"split":"train","metrics":{"loss_total":2.5}}\n',
        encoding="utf-8",
    )
    register_experiment(
        tmp_path,
        {
            "experiment_id": "unit-demo",
            "title": "Unit Demo",
            "status": "running",
            "sources": [
                {
                    "id": "metrics-demo-jsonl",
                    "channel": "metrics",
                    "type": "jsonl",
                    "path": ".thoth/extensions/plugins/metrics-demo/metrics.jsonl",
                    "series": "train",
                }
            ],
        },
        actor="test",
        source="test",
        surface="unit",
    )
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    observe = client.get("/api/observe")
    plugins = client.get("/api/plugins")
    tools = client.get("/api/tools")
    metrics = client.get("/api/metrics")

    assert observe.status_code == 200
    assert observe.json()["providers"]["metrics"]["record_count"] == 2
    assert plugins.status_code == 200
    assert plugins.json()["enabled_plugin_count"] == 1
    assert tools.status_code == 200
    assert {tool["id"] for tool in tools.json()["tools"]} >= {"todo", "thoth-triggers"}
    assert metrics.status_code == 200
    assert metrics.json()["metrics"][0]["name"] == "train.loss_total"
    assert metrics.json()["experiment_id"] == "unit-demo"

    experiments = client.get("/api/experiments")
    assert experiments.status_code == 200
    assert experiments.json()["effective_experiment_id"] == "unit-demo"
    assert experiments.json()["experiments"][0]["experiment_id"] == "unit-demo"

    channel = client.get("/api/experiments/unit-demo/channels/metrics")
    assert channel.status_code == 200
    assert channel.json()["record_count"] == 2

    rejected_register = client.post("/api/experiments", json={"experiment_id": "blocked"})
    assert rejected_register.status_code == 403

    token = client.get("/api/action-token").json()["token"]
    registered = client.post(
        "/api/experiments",
        headers={"X-Thoth-Action-Token": token},
        json={
            "experiment_id": "dashboard-demo",
            "title": "Dashboard Demo",
            "status": "planned",
            "actor": {"actor": "dashboard-test", "source": "test", "surface": "dashboard"},
            "sources": [],
        },
    )
    assert registered.status_code == 200
    assert registered.json()["experiment"]["experiment_id"] == "dashboard-demo"


def test_delta_sse_index_and_debug_endpoints(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    record_action_receipt(
        tmp_path,
        action="unit.debug",
        status="ok",
        summary="debug receipt",
    )
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    first_delta = client.get("/api/delta")
    assert first_delta.status_code == 200
    first_payload = first_delta.json()
    assert first_payload["changed"] is True
    assert first_payload["cursor"]

    second_delta = client.get(f"/api/delta?cursor={first_payload['cursor']}")
    assert second_delta.status_code == 200
    assert second_delta.json()["changed"] is False

    stream = client.get("/api/invalidation/stream?once=true")
    assert stream.status_code == 200
    assert "text/event-stream" in stream.headers["content-type"]
    assert "event: thoth.invalidate" in stream.text

    token_response = client.get("/api/action-token")
    assert token_response.status_code == 200
    token = token_response.json()["token"]
    assert token_response.json()["header"] == "X-Thoth-Action-Token"

    rejected_index = client.post("/api/read-model/index")
    assert rejected_index.status_code == 403

    index = client.post("/api/read-model/index", headers={"X-Thoth-Action-Token": token})
    assert index.status_code == 200
    index_payload = index.json()
    assert index_payload["sqlite"]["available"] is True
    assert index_payload["counts"]["work_items"] == 1
    assert "available" in index_payload["duckdb"]

    debug = client.get("/api/debug/summary")
    assert debug.status_code == 200
    debug_payload = debug.json()
    assert debug_payload["plugins"]["manifest_path"] == ".thoth/extensions/manifest.json"
    assert debug_payload["actions"]["recent_receipts"][0]["action"] == "unit.debug"


def test_runtime_progress_reports_auto_failed_attempt_counts(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    controller_path = tmp_path / ".thoth" / "objects" / "controller" / "controller-auto-1.json"
    controller = json.loads(controller_path.read_text(encoding="utf-8"))
    controller["payload"]["attempts"] = [
        {
            "work_id": "task-1",
            "run_id": "run-1",
            "status": "failed",
            "child_status": 1,
            "finished_at": "2026-04-23T01:12:00Z",
        }
    ]
    controller_path.write_text(json.dumps(controller, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    progress = client.get("/api/progress")

    assert progress.status_code == 200
    auto = progress.json()["runtime"]["active_auto_controllers"][0]
    assert auto["attempt_count"] == 1
    assert auto["failed_attempt_count"] == 1
    assert auto["failed_count"] == 1


def test_dag_marks_ready_work_waiting_on_unvalidated_dependencies(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    upsert_work_item(
        tmp_path,
        {
            "work_id": "task-upstream",
            "title": "Upstream work",
            "status": "ready",
            "goal": "Finish upstream dependency.",
            "context": "frontend-runtime",
            "constraints": ["dashboard"],
            "acceptance_spec": {
                "kind": "script",
                "description": "Run upstream pytest.",
                "metric": {"name": "checks", "direction": "gte", "threshold": 1},
            },
            "approach_notes": ["Run upstream lifecycle."],
            "scheduling": {"order": None},
            "missing_questions": [],
        },
    )
    Store(tmp_path).link("work_item", "task-1", link_type="depends_on", target_kind="work_item", target_id="task-upstream")
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    response = client.get("/api/dag")

    assert response.status_code == 200
    nodes = {node["id"]: node for node in response.json()["nodes"]}
    assert nodes["task-1"]["authority_status"] == "ready"
    assert nodes["task-1"]["status"] == "ready"
    assert nodes["task-1"]["actionability"] == "waiting_on"
    assert nodes["task-1"]["waiting_on"] == ["task-upstream"]
    assert nodes["task-upstream"]["downstream"] == ["task-1"]


def test_overview_summary_and_gantt_endpoints(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    upsert_work_result(
        tmp_path,
        "task-1",
        {
            "source": "unit",
            "usable": True,
            "meets_goal": True,
            "conclusion": "Runtime dashboard conclusion",
            "evidence_paths": ["reports/runtime.md"],
            "updated_at": "2026-04-23T02:00:00Z",
        },
    )
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    summary = client.get("/api/overview-summary")
    assert summary.status_code == 200
    summary_payload = summary.json()
    assert summary_payload["headline"]["total_work_items"] == 1
    assert summary_payload["runtime"]["active_run_count"] == 1
    assert summary_payload["runtime"]["active_auto_count"] == 1
    assert summary_payload["recent_conclusions"][0]["module"] == "frontend-runtime"
    assert summary_payload["recent_conclusions"][0]["direction"] == "frontend"

    gantt = client.get("/api/gantt")
    assert gantt.status_code == 200
    gantt_payload = gantt.json()
    assert gantt_payload[0]["id"] == "task-1"
    assert gantt_payload[0]["status"] == "completed"
    assert gantt_payload[0]["dependencies"] == []


def test_spa_entry_routes_return_frontend_shell(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    for route in ("/", "/overview", "/work-items", "/timeline", "/system"):
        response = client.get(route)
        assert response.status_code == 200
        assert "dashboard shell" in response.text

    for old_route in ("/tasks", "/api/tasks"):
        response = client.get(old_route)
        assert response.status_code == 404
