"""Auto controller execution for unattended ready work."""

from __future__ import annotations

from pathlib import Path
from time import time
from typing import Any, Callable

from thoth.objects import Store, utc_now
from thoth.plan.store import load_work_for_execution
from thoth.run.controllers import list_auto_actionable_work
from thoth.run.driver import JsonlStdoutSink, RuntimeEventSink, SilentSink, execute_runtime_controller
from thoth.run.ledger import _append_event
from thoth.run.model import ACTIVE_STATUSES, RunHandle
from thoth.run.packets import prepare_execution
from thoth.run.service import attach_run, list_active_runs


DriverFactory = Callable[[RunHandle], Any]


def _emit(sink: RuntimeEventSink, controller_id: str, event_type: str, **payload: Any) -> None:
    event = {"type": event_type, "ts": utc_now(), "controller_id": controller_id}
    event.update({key: value for key, value in payload.items() if value is not None})
    sink.emit(event)


def _update_controller(project_root: Path, controller: dict[str, Any], *, status: str, payload_updates: dict[str, Any]) -> dict[str, Any]:
    store = Store(project_root)
    payload = dict(controller.get("payload") if isinstance(controller.get("payload"), dict) else {})
    payload.update(payload_updates)
    return store.update(
        "controller",
        str(controller["object_id"]),
        expected_revision=int(controller.get("revision", 0)),
        updates={"status": status, "payload": payload},
        history_summary=f"auto controller -> {status}",
        source="auto",
    )


def _active_run_for_work(project_root: Path, work_id: str) -> str | None:
    for row in list_active_runs(project_root):
        if row.get("work_id") == work_id:
            return str(row.get("run_id"))
    runs_root = project_root / ".thoth" / "runs"
    if not runs_root.is_dir():
        return None
    for run_dir in sorted(runs_root.iterdir()):
        if not run_dir.is_dir():
            continue
        handle = RunHandle(project_root=project_root, run_id=run_dir.name)
        state = handle.state_json()
        run = handle.run_json()
        if state.get("status") in ACTIVE_STATUSES and run.get("work_id") == work_id:
            return handle.run_id
    return None


def _should_stop(controller: dict[str, Any]) -> bool:
    status = str(controller.get("status") or "")
    payload = controller.get("payload") if isinstance(controller.get("payload"), dict) else {}
    state = str(payload.get("state") or "")
    return status in {"stopped", "cancelled"} or state in {"stopped", "cancelled"}


def execute_auto_controller(
    project_root: Path,
    controller_id: str,
    *,
    driver_factory: DriverFactory,
    sink: RuntimeEventSink | None = None,
) -> int:
    event_sink = sink or SilentSink()
    store = Store(project_root)
    controller = store.read("controller", controller_id)
    if not controller:
        raise FileNotFoundError(f"controller:{controller_id} not found")
    payload = controller.get("payload") if isinstance(controller.get("payload"), dict) else {}
    if payload.get("controller_type") != "auto":
        raise ValueError(f"controller:{controller_id} is not an auto controller")

    started_at = time()
    rounds = payload.get("rounds")
    rounds_limit = rounds if isinstance(rounds, int) and rounds > 0 else None
    scope = str(payload.get("scope") or "all-open")
    host = str(payload.get("host") or "codex")
    executor = str(payload.get("executor") or "codex")
    controller = _update_controller(
        project_root,
        controller,
        status="running",
        payload_updates={"started_at": utc_now(), "state": "running"},
    )
    _emit(event_sink, controller_id, "thoth.auto.started", scope=scope, rounds=rounds_limit)

    rounds_attempted = 0
    completed_work_ids: list[str] = []
    while True:
        controller = store.read("controller", controller_id) or controller
        if _should_stop(controller):
            _emit(event_sink, controller_id, "thoth.auto.stopped", reason="stop_requested")
            return 130
        payload = controller.get("payload") if isinstance(controller.get("payload"), dict) else {}
        cursor = payload.get("cursor") if isinstance(payload.get("cursor"), dict) else {}
        rounds_attempted = int(cursor.get("rounds_attempted") or rounds_attempted)
        if rounds_limit is not None and rounds_attempted >= rounds_limit:
            controller = _update_controller(
                project_root,
                controller,
                status="paused",
                payload_updates={
                    "state": "budget_exhausted",
                    "budget_exhausted_by": "rounds",
                    "finished_at": utc_now(),
                    "cursor": {**cursor, "rounds_attempted": rounds_attempted},
                },
            )
            _emit(event_sink, controller_id, "thoth.auto.paused", reason="rounds", rounds_attempted=rounds_attempted)
            return 2

        actionable = list_auto_actionable_work(project_root, scope=scope)
        payload["queue"] = [
            {
                "work_id": row.get("work_id"),
                "revision": row.get("revision"),
                "title": row.get("title"),
                "status": row.get("ready_state"),
                "priority": row.get("priority"),
            }
            for row in actionable
        ]
        if not actionable:
            elapsed = int(time() - started_at)
            controller = _update_controller(
                project_root,
                controller,
                status="completed",
                payload_updates={
                    "state": "completed",
                    "finished_at": utc_now(),
                    "elapsed_seconds": elapsed,
                    "completed_work_ids": completed_work_ids,
                    "queue": [],
                },
            )
            _emit(event_sink, controller_id, "thoth.auto.terminal", status="completed", elapsed_seconds=elapsed)
            return 0

        work = actionable[0]
        work_id = str(work.get("work_id") or "")
        work_status = str(work.get("ready_state") or "")
        active_run_id = _active_run_for_work(project_root, work_id) if work_status == "active" else None
        if active_run_id:
            _emit(event_sink, controller_id, "thoth.auto.monitor", work_id=work_id, run_id=active_run_id)
            attach_output = attach_run(project_root, active_run_id, watch=True, timeout_seconds=5.0)
            _emit(event_sink, controller_id, "thoth.auto.monitor.tick", work_id=work_id, run_id=active_run_id, summary=attach_output)
            controller = store.read("controller", controller_id)
            continue

        strict_task = load_work_for_execution(project_root, work_id, require_ready=False)
        if strict_task.get("runnable") is not True:
            _emit(event_sink, controller_id, "thoth.auto.skipped", work_id=work_id, reason="non_runnable")
            controller = store.read("controller", controller_id)
            continue
        handle, _packet = prepare_execution(
            project_root,
            command_id="loop",
            title=str(strict_task.get("title") or work_id),
            work_id=work_id,
            host=host,
            executor=executor,
            sleep_requested=False,
            strict_task=strict_task,
            goal=str(strict_task.get("goal_statement") or strict_task.get("title") or work_id),
        )
        rounds_attempted += 1
        cursor = {
            "index": rounds_attempted - 1,
            "active_run_id": handle.run_id,
            "completed_work_ids": completed_work_ids,
            "rounds_attempted": rounds_attempted,
        }
        controller = _update_controller(project_root, controller, status="running", payload_updates={"cursor": cursor})
        _emit(event_sink, controller_id, "thoth.auto.child.started", work_id=work_id, run_id=handle.run_id, round=rounds_attempted)
        child_status = execute_runtime_controller(project_root, handle.run_id, driver=driver_factory(handle), sink=event_sink)
        if child_status == 0:
            completed_work_ids.append(work_id)
        child_handle = RunHandle(project_root=project_root, run_id=handle.run_id)
        _append_event(child_handle, f"auto controller {controller_id} observed child exit {child_status}", kind="auto")
        controller = store.read("controller", controller_id)
        if controller and _should_stop(controller):
            _emit(event_sink, controller_id, "thoth.auto.stopped", reason="stop_requested")
            return 130
        payload = controller.get("payload") if isinstance(controller.get("payload"), dict) else {}
        payload["cursor"] = {
            "index": rounds_attempted,
            "active_run_id": None,
            "completed_work_ids": completed_work_ids,
            "rounds_attempted": rounds_attempted,
        }
        controller = _update_controller(project_root, controller, status="running", payload_updates=payload)


def stdout_sink() -> JsonlStdoutSink:
    return JsonlStdoutSink()
