"""Run, loop, review, prepare, and worker command handlers."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.objects import Store, utc_now
from thoth.plan.compiler import compile_task_authority
from thoth.plan.doctor import build_doctor_payload, infer_review_work_id
from thoth.plan.paths import compiler_state_path, work_items_dir
from thoth.plan.store import load_work_for_execution, suggest_work_items_for_query
from thoth.run.auto import (
    auto_controller_fingerprint,
    auto_fingerprint_differences,
    ensure_auto_worker,
    execute_auto_controller,
    find_reusable_auto_controller,
    watch_auto_controller,
)
from thoth.run.controllers import build_auto_request_fingerprint, create_auto_controller, create_orchestration_controller
from thoth.run.driver import JsonlStdoutSink, execute_runtime_controller
from thoth.run.guidance import append_run_guidance, guidance_path
from thoth.run.model import RunHandle
from thoth.run.packets import LIVE_DISPATCH_MODE, prepare_execution
from thoth.run.phases import load_phase_state
from thoth.run.reconcile import reconcile_run
from thoth.run.service import attach_run, list_active_runs, resume_run, stop_run
from thoth.run.worker import (
    ExternalWorkerPhaseDriver,
    TestPhaseDriver,
    _normalize_worker_executor,
    _test_external_worker_mode,
    spawn_supervisor,
    supervisor_main,
    worker_main,
)
from thoth.surface.envelope import output_refs, print_envelope
from thoth.surface.plan_commands import append_project_note


def handle_supervise(args, parser, *, project_root: Path) -> int:
    return supervisor_main(Path(args.project_root), args.run_id)


def handle_worker(args, parser, *, project_root: Path) -> int:
    return worker_main(Path(args.project_root), args.run_id)


def handle_auto_worker(args, parser, *, project_root: Path) -> int:
    root = Path(args.project_root).resolve()
    return execute_auto_controller(
        root,
        args.controller_id,
        driver_factory=_driver_for_handle,
        sink=JsonlStdoutSink(),
    )


def _missing_task_query(args, *, command_id: str) -> str:
    parts: list[str] = []
    prompt_query = str(getattr(args, "prompt_query", "") or "").strip()
    if prompt_query:
        parts.append(prompt_query)
    goal = str(getattr(args, "goal", "") or "").strip()
    if goal and not (command_id == "loop" and goal == "loop"):
        parts.append(goal)
    target = str(getattr(args, "target", "") or "").strip()
    if target:
        parts.append(target)
    return " ".join(parts).strip()


def _reject_missing_work_id(*, command_id: str, args, project_root: Path) -> int:
    query = _missing_task_query(args, command_id=command_id)
    candidates = suggest_work_items_for_query(project_root, query, limit=3)
    summary = (
        f"`{command_id}` requires --work-id. No work item was created and no code was touched."
    )
    body = {
        "query": query or None,
        "candidates": candidates,
        "guidance": f"Re-run with `{command_id} --work-id <work_id>` after choosing one of the suggested work items.",
    }
    print_envelope(
        command=command_id,
        status="needs_input",
        summary=summary,
        body=body,
        refs=output_refs(work_items_dir(project_root), compiler_state_path(project_root)),
        checks=[
            {"name": "work_id_required", "ok": False, "detail": "--work-id missing"},
            {"name": "work_creation_blocked", "ok": True, "detail": "no new work item created"},
            {"name": "code_execution_blocked", "ok": True, "detail": "no code touched"},
        ],
    )
    return 2


def _reject_authority_resolution(*, command_id: str, project_root: Path, work_id: str, reason: str) -> int:
    print_envelope(
        command=command_id,
        status="needs_input",
        summary=f"`{command_id}` could not resolve closed authority for {work_id}.",
        body={
            "work_id": work_id,
            "reason": reason,
            "guidance": "Run `thoth init --sync` to backfill unambiguous legacy authority, or return to `thoth discuss` to bind this work item to a single closed discussion.",
        },
        refs=output_refs(work_items_dir(project_root), compiler_state_path(project_root)),
        checks=[{"name": "authority_context_resolved", "ok": False, "detail": reason}],
    )
    return 2


def _resolve_executor(args) -> str:
    explicit = str(getattr(args, "executor", "") or "").strip().lower()
    if explicit:
        return "codex" if explicit == "codex" else "claude"
    return "codex"


def _prompt_query(args) -> str:
    return str(getattr(args, "prompt_query", "") or "").strip()


def _guidance_interrupt_requested(message: str) -> bool:
    text = message.lower()
    triggers = (
        "interrupt",
        "stop current",
        "restart phase",
        "start over",
        "right now",
        "don't continue",
        "do not continue",
        "停",
        "别继续",
        "不要继续",
        "重来",
        "立刻",
        "马上",
        "现在改",
    )
    return any(trigger in text for trigger in triggers)


def _append_guidance_to_run(
    project_root: Path,
    run_id: str,
    *,
    message: str,
    source: str = "host_agent",
    phase: str | None = None,
    interrupt_requested: bool | None = None,
) -> list[dict]:
    interrupt = _guidance_interrupt_requested(message) if interrupt_requested is None else bool(interrupt_requested)
    entries = [
        append_run_guidance(
            project_root,
            run_id,
            message=message,
            source=source,
            phase=phase,
            interrupt_requested=interrupt,
        )
    ]
    controller = load_phase_state(RunHandle(project_root=project_root.resolve(), run_id=run_id))
    if controller.get("mode") == "loop_parent":
        loop = controller.get("loop") if isinstance(controller.get("loop"), dict) else {}
        child_run_id = loop.get("active_child_run_id")
        if isinstance(child_run_id, str) and child_run_id.strip():
            entries.append(
                append_run_guidance(
                    project_root,
                    child_run_id,
                    message=message,
                    source=source,
                    phase=phase,
                    interrupt_requested=interrupt,
                    parent_run_id=run_id,
                )
            )
    return entries


def _append_guidance_to_single_active_run(project_root: Path, *, command_id: str, message: str) -> int | None:
    active = [row for row in list_active_runs(project_root) if row.get("kind") == command_id]
    if len(active) != 1:
        return None
    run_id = str(active[0].get("run_id") or "")
    entries = _append_guidance_to_run(project_root, run_id, message=message, source="host_agent")
    print_envelope(
        command=command_id,
        status="ok",
        summary=f"Appended live guidance to {run_id}",
        body={"run_id": run_id, "guidance": entries},
        refs=output_refs(guidance_path(project_root, run_id)),
        checks=[{"name": "guidance_appended", "ok": True, "detail": run_id}],
    )
    return 0


def _append_auto_guidance(project_root: Path, controller: dict, message: str) -> dict:
    store = Store(project_root)
    controller_id = str(controller.get("object_id") or "")
    payload = dict(controller.get("payload") if isinstance(controller.get("payload"), dict) else {})
    payload["guidance"] = {
        "message": message,
        "source": "host_agent",
        "semantics": "temporary controller-level execution guidance; authority and validators remain unchanged",
        "created_at": utc_now(),
    }
    cursor = payload.get("cursor") if isinstance(payload.get("cursor"), dict) else {}
    active_run_id = cursor.get("active_run_id")
    if isinstance(active_run_id, str) and active_run_id:
        _append_guidance_to_run(project_root, active_run_id, message=message, source="host_agent")
    return store.update(
        "controller",
        controller_id,
        expected_revision=int(controller.get("revision", 0)),
        updates={"payload": payload},
        history_summary="auto guidance appended",
        source="auto",
    )


def _driver_for_handle(handle):
    test_mode = _test_external_worker_mode()
    if test_mode in {"complete", "fail"}:
        return TestPhaseDriver(test_mode)
    executor = _normalize_worker_executor(handle.run_json().get("executor"))
    return ExternalWorkerPhaseDriver(executor=executor, run_payload=handle.run_json())


def _auto_preflight_failures(doctor: dict) -> list[dict]:
    ignored_ids = {"no-proposed-decisions", "no-blocked-work-items"}
    checks = doctor.get("checks") if isinstance(doctor.get("checks"), list) else []
    failures: list[dict] = []
    for check in checks:
        if not isinstance(check, dict):
            continue
        if check.get("id") in ignored_ids:
            continue
        if check.get("ok") is not True:
            failures.append(check)
    return failures


def _auto_preflight_has_stale_summary(failures: list[dict]) -> bool:
    return any(check.get("id") == "object-graph-summary-current" for check in failures)


def _auto_execution_safety_doctor(project_root: Path) -> tuple[dict, list[dict], dict]:
    doctor = build_doctor_payload(project_root)
    failures = _auto_preflight_failures(doctor)
    refresh: dict = {"attempted": False, "reason": None, "ok": None}
    if _auto_preflight_has_stale_summary(failures):
        refresh = {"attempted": True, "reason": "object_graph_summary_stale", "ok": False}
        try:
            compile_task_authority(project_root)
        except Exception as exc:
            refresh["error"] = str(exc)
        else:
            refresh["ok"] = True
            doctor = build_doctor_payload(project_root)
            failures = _auto_preflight_failures(doctor)
    return doctor, failures, refresh


def handle_prepare(args, parser, *, project_root: Path) -> int:
    root = Path(args.project_root).resolve() if getattr(args, "project_root", None) else project_root
    work_id = getattr(args, "work_id", None)
    title = str(args.goal or args.target or work_id or args.command_id)
    strict_task = None
    if args.command_id in {"run", "loop"}:
        if not work_id:
            return _reject_missing_work_id(command_id=args.command_id, args=args, project_root=root)
        strict_task = load_work_for_execution(root, work_id, require_ready=True)
        title = str(strict_task.get("title") or work_id)
    elif args.command_id == "review" and work_id:
        strict_task = load_work_for_execution(root, work_id, require_ready=True)
        title = str(strict_task.get("title") or f"Review: {work_id}")
    elif args.command_id == "review" and not (args.target or args.goal):
        parser.exit(2, "thoth: error: Review prepare requires --target or --goal.\n")
    try:
        handle, packet = prepare_execution(root, command_id=args.command_id, title=title, work_id=work_id, host=args.host, executor=_resolve_executor(args), sleep_requested=bool(args.sleep), strict_task=strict_task, target=args.target, goal=args.goal or title, invocation_guidance=_prompt_query(args))
    except ValueError as exc:
        if work_id and "authority" in str(exc):
            return _reject_authority_resolution(command_id=args.command_id, project_root=root, work_id=work_id, reason=str(exc))
        raise
    if packet.get("dispatch_mode") != LIVE_DISPATCH_MODE:
        spawn_supervisor(handle)
        packet["worker_spawned"] = True
        packet["background_mode"] = "detached"
    print(json.dumps(packet, ensure_ascii=False, indent=2))
    return 0


def handle_review(args, parser, *, project_root: Path) -> int:
    content = (getattr(args, "goal", None) or " ".join(getattr(args, "rest", []) or [])).strip()
    note_path = append_project_note(project_root, "review", content)
    if not content:
        parser.exit(2, "thoth: error: Review target is required.\n")
    review_work_id = getattr(args, "work_id", None) or infer_review_work_id(project_root, content)
    strict_task = None
    if review_work_id:
        strict_task = load_work_for_execution(project_root, review_work_id, require_ready=True)
    try:
        handle, packet = prepare_execution(
            project_root,
            command_id="review",
            title=f"Review: {content}",
            work_id=review_work_id,
            host=args.host,
            executor=_resolve_executor(args),
            sleep_requested=False,
            strict_task=strict_task,
            target=content,
            goal=getattr(args, "goal", None) or content,
        )
    except ValueError as exc:
        if review_work_id and "authority" in str(exc):
            return _reject_authority_resolution(command_id="review", project_root=project_root, work_id=review_work_id, reason=str(exc))
        raise
    print_envelope(command="review", status="ok", summary=f"Prepared live review packet for {content}", body={"packet": packet, "note_path": str(note_path)}, refs=output_refs(note_path, handle.run_dir), checks=[{"name": "live_only", "ok": packet.get("dispatch_mode") == LIVE_DISPATCH_MODE}])
    return 0


def handle_run_or_loop(args, parser, *, project_root: Path) -> int:
    guidance_message = _prompt_query(args)
    if args.command == "run" and getattr(args, "reconcile", None):
        result = reconcile_run(project_root, str(args.reconcile))
        status = "ok" if result.get("status") == "ok" else "needs_input"
        print_envelope(
            command="run",
            status=status,
            summary=(
                f"Reconciled historical run {args.reconcile}"
                if status == "ok"
                else f"Run {args.reconcile} was not safe to reconcile: {result.get('reason')}"
            ),
            body={"result": result},
            refs=output_refs(project_root / ".thoth" / "runs" / str(args.reconcile)),
            checks=[{"name": "reconcile_safe", "ok": status == "ok", "detail": str(result.get("reason") or "ok")}],
        )
        return 0 if status == "ok" else 2
    if getattr(args, "attach", None):
        if guidance_message:
            entries = _append_guidance_to_run(project_root, args.attach, message=guidance_message, source="host_agent")
            print_envelope(command=args.command, status="ok", summary=f"Appended live guidance to {args.attach}", body={"run_id": args.attach, "guidance": entries}, refs=output_refs(guidance_path(project_root, args.attach)))
            return 0
        print_envelope(command=args.command, status="ok", summary=f"Attached to {args.attach}", body={"attach_output": attach_run(project_root, args.attach, watch=False)}, refs=output_refs(project_root / ".thoth" / "runs" / args.attach))
        return 0
    if getattr(args, "watch", None):
        if guidance_message:
            entries = _append_guidance_to_run(project_root, args.watch, message=guidance_message, source="host_agent")
            print_envelope(command=args.command, status="ok", summary=f"Appended live guidance to {args.watch}", body={"run_id": args.watch, "guidance": entries}, refs=output_refs(guidance_path(project_root, args.watch)))
            return 0
        print_envelope(command=args.command, status="ok", summary=f"Watching {args.watch}", body={"watch_output": attach_run(project_root, args.watch, watch=True)}, refs=output_refs(project_root / ".thoth" / "runs" / args.watch))
        return 0
    if getattr(args, "stop", None):
        stop_run(project_root, args.stop)
        print_envelope(command=args.command, status="ok", summary=f"Stop requested for {args.stop}", refs=output_refs(project_root / ".thoth" / "runs" / args.stop))
        return 0
    if args.command == "loop" and getattr(args, "resume", None):
        handle = resume_run(project_root, args.resume)
        packet_path = handle.run_dir / "packet.json"
        if handle.run_json().get("dispatch_mode") != LIVE_DISPATCH_MODE:
            spawn_supervisor(handle)
        packet = json.loads(packet_path.read_text(encoding="utf-8")) if packet_path.exists() else {"run_id": handle.run_id}
        print_envelope(command="loop", status="ok", summary=f"Resumed loop {handle.run_id}", body={"packet": packet}, refs=output_refs(handle.run_dir, packet_path))
        return 0
    work_id = getattr(args, "work_id", None)
    if not work_id:
        if guidance_message:
            appended = _append_guidance_to_single_active_run(project_root, command_id=args.command, message=guidance_message)
            if appended is not None:
                return appended
        return _reject_missing_work_id(command_id=args.command, args=args, project_root=project_root)
    task = load_work_for_execution(project_root, work_id, require_ready=True)
    try:
        handle, packet = prepare_execution(project_root, command_id=args.command, title=str(task.get("title") or work_id), work_id=work_id, host=args.host, executor=_resolve_executor(args), sleep_requested=bool(args.sleep), strict_task=task, goal=getattr(args, "goal", None) or str(task.get("title") or work_id), invocation_guidance=guidance_message)
    except ValueError as exc:
        if "authority" in str(exc):
            return _reject_authority_resolution(command_id=args.command, project_root=project_root, work_id=work_id, reason=str(exc))
        raise
    if packet.get("dispatch_mode") != LIVE_DISPATCH_MODE:
        spawn_supervisor(handle)
        packet["worker_spawned"] = True
        print_envelope(command=args.command, status="ok", summary=f"Started sleeping {args.command} for {work_id}", body={"packet": packet}, refs=output_refs(handle.run_dir, handle.run_dir / "packet.json"), checks=[{"name": "dispatch_mode", "ok": True, "detail": str(packet.get("dispatch_mode"))}])
        return 0
    return execute_runtime_controller(project_root, handle.run_id, driver=_driver_for_handle(handle), sink=JsonlStdoutSink())


def handle_orchestration(args, parser, *, project_root: Path) -> int:
    controller = create_orchestration_controller(
        project_root,
        work_ids=list(getattr(args, "work_ids", []) or []),
        host=args.host,
        executor=_resolve_executor(args),
    )
    print_envelope(
        command="orchestration",
        status="ok",
        summary=f"Created orchestration controller {controller['object_id']}",
        body={"controller": controller},
        refs=output_refs(project_root / ".thoth" / "objects" / "controller" / f"{controller['object_id']}.json"),
        checks=[{"name": "controller_object", "ok": True, "detail": controller["object_id"]}],
    )
    return 0


def handle_append_guidance(args, parser, *, project_root: Path) -> int:
    root = Path(args.project_root).resolve()
    run_id = str(args.run_id)
    entries = _append_guidance_to_run(
        root,
        run_id,
        message=str(args.message),
        source=str(getattr(args, "source", "") or "host_agent"),
        phase=getattr(args, "phase", None),
        interrupt_requested=bool(getattr(args, "interrupt", False)),
    )
    print_envelope(
        command="append-guidance",
        status="ok",
        summary=f"Appended live guidance to {run_id}",
        body={"run_id": run_id, "guidance": entries},
        refs=output_refs(guidance_path(root, run_id)),
        checks=[{"name": "guidance_appended", "ok": True, "detail": run_id}],
    )
    return 0


def handle_auto(args, parser, *, project_root: Path) -> int:
    guidance_message = _prompt_query(args)
    if getattr(args, "watch", None):
        if guidance_message:
            store = Store(project_root)
            controller = store.read("controller", str(args.watch))
            if not controller:
                print_envelope(command="auto", status="failed", summary=f"Auto controller {args.watch} not found")
                return 1
            controller = _append_auto_guidance(project_root, controller, guidance_message)
            print_envelope(command="auto", status="ok", summary=f"Appended controller guidance to {args.watch}", body={"controller": controller}, refs=output_refs(project_root / ".thoth" / "objects" / "controller" / f"{args.watch}.json"))
            return 0
        return watch_auto_controller(
            project_root,
            str(args.watch),
            sink=JsonlStdoutSink(),
            follow=bool(getattr(args, "follow", False)),
        )
    if getattr(args, "stop", None):
        store = Store(project_root)
        current = store.read("controller", args.stop)
        if not current:
            print_envelope(command="auto", status="failed", summary=f"Auto controller {args.stop} not found")
            return 1
        payload = current.get("payload") if isinstance(current.get("payload"), dict) else {}
        cursor = payload.get("cursor") if isinstance(payload.get("cursor"), dict) else {}
        active_run_id = cursor.get("active_run_id")
        stopped_child_run_id = None
        if isinstance(active_run_id, str) and active_run_id:
            stop_run(project_root, active_run_id)
            stopped_child_run_id = active_run_id
        payload["state"] = "stopped"
        payload["stopped_at"] = utc_now()
        store.update(
            "controller",
            args.stop,
            expected_revision=int(current.get("revision", 0)),
            updates={"status": "stopped", "payload": payload},
            history_summary="auto stop requested",
            source="auto",
        )
        print_envelope(
            command="auto",
            status="ok",
            summary=f"Stop requested for auto controller {args.stop}",
            body={"controller_id": args.stop, "stopped_child_run_id": stopped_child_run_id},
        )
        return 0
    min_runtime_arg = getattr(args, "min_runtime_seconds", 8 * 60 * 60)
    min_runtime_seconds = int(min_runtime_arg) if isinstance(min_runtime_arg, int) and min_runtime_arg >= 0 else 8 * 60 * 60
    requested_fingerprint = build_auto_request_fingerprint(
        project_root,
        work_ids=list(getattr(args, "work_ids", []) or []),
        mode="loop",
        host=args.host,
        executor=_resolve_executor(args),
        scope=getattr(args, "scope", "all-open"),
        rounds=getattr(args, "rounds", None),
        min_runtime_seconds=min_runtime_seconds,
        sleep_requested=bool(getattr(args, "sleep", False)),
    )
    reused = False
    controller = find_reusable_auto_controller(project_root)
    if controller:
        diffs = auto_fingerprint_differences(auto_controller_fingerprint(controller), requested_fingerprint)
        if diffs:
            controller_id = str(controller.get("object_id") or "")
            print_envelope(
                command="auto",
                status="needs_input",
                summary=f"Active auto controller {controller_id} has different request parameters; no new controller was started.",
                body={
                    "active_controller_id": controller_id,
                    "differences": diffs,
                    "guidance": f"Use `thoth auto --watch {controller_id} --follow --stream-json`, stop it first, or explicitly start a new controller after adding a public --new policy.",
                },
                refs=output_refs(project_root / ".thoth" / "objects" / "controller" / f"{controller_id}.json"),
                checks=[{"name": "auto_request_fingerprint", "ok": False, "detail": "active controller parameters differ"}],
            )
            return 2
        if guidance_message:
            controller = _append_auto_guidance(project_root, controller, guidance_message)
        reused = True
    else:
        doctor, preflight_failures, preflight_refresh = _auto_execution_safety_doctor(project_root)
        if preflight_failures:
            print_envelope(
                command="auto",
                status="failed",
                summary="Auto preflight failed execution-safety doctor; no work was executed.",
                body={"doctor": doctor, "preflight_refresh": preflight_refresh},
                refs=output_refs(project_root / ".thoth" / "docs" / "object-graph-summary.json"),
                checks=preflight_failures,
            )
            return 1
        controller = create_auto_controller(
            project_root,
            work_ids=list(getattr(args, "work_ids", []) or []),
            mode="loop",
            host=args.host,
            executor=_resolve_executor(args),
            scope=getattr(args, "scope", "all-open"),
            rounds=getattr(args, "rounds", None),
            min_runtime_seconds=min_runtime_seconds,
            sleep_requested=bool(getattr(args, "sleep", False)),
            invocation_guidance=guidance_message,
        )
    controller_id = str(controller["object_id"])
    spawned, worker_pid = ensure_auto_worker(project_root, controller_id)
    monitor_command = f"thoth auto --watch {controller_id} --follow --stream-json"
    if getattr(args, "sleep", False) or getattr(args, "monitor_packet", False):
        print_envelope(
            command="auto",
            status="ok",
            summary=f"{'Reused' if reused else 'Started'} auto controller {controller_id}",
            body={
                "controller": controller,
                "background_mode": "detached",
                "controller_id": controller_id,
                "worker_pid": worker_pid,
                "worker_spawned": spawned,
                "started_or_reused": "reused" if reused else "started",
                "monitor_command": monitor_command,
            },
            refs=output_refs(project_root / ".thoth" / "objects" / "controller" / f"{controller_id}.json"),
            checks=[{"name": "controller_object", "ok": True, "detail": controller_id}],
        )
        return 0
    return watch_auto_controller(
        project_root,
        controller_id,
        sink=JsonlStdoutSink(),
        follow=True,
    )
