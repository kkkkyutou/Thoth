"""Observe/read public commands."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from thoth.observe.dashboard import manage_dashboard
from thoth.observe.report import generate_default_report, render_report_summary
from thoth.observe.status import render_status
from thoth.init.service import initialize_project, preview_project_migration
from thoth.plan.doctor import build_doctor_payload, render_doctor_text
from thoth.run.status import build_status_payload
from thoth.surface.envelope import output_refs, print_envelope


def handle_status(args, parser, *, project_root: Path) -> int:
    if getattr(args, "doctor", False):
        return handle_doctor(args, parser, project_root=project_root)
    if getattr(args, "report", False):
        return handle_report(args, parser, project_root=project_root)
    dashboard_action = getattr(args, "dashboard", None)
    if dashboard_action:
        setattr(args, "action", dashboard_action)
        return handle_dashboard(args, parser, project_root=project_root)
    payload = build_status_payload(project_root)
    if args.json:
        print_envelope(command="status", status="ok", summary=f"Loaded status for {payload['project_root']}", body={"status": payload}, refs=output_refs(project_root / ".thoth" / "objects" / "project" / "project.json"), checks=[{"name": "active_run_count", "ok": True, "detail": str(payload.get("active_run_count", 0))}])
    else:
        print(render_status(project_root, full=False))
    return 0


def _handle_doctor_fix(args, parser, *, project_root: Path) -> int:
    if getattr(args, "preview", False) and getattr(args, "apply", False):
        parser.exit(2, "thoth: error: doctor --fix accepts only one of --preview or --apply.\n")
    if not getattr(args, "preview", False) and not getattr(args, "apply", False):
        print_envelope(
            command="doctor",
            status="needs_input",
            summary="Doctor fix requires explicit --preview or --apply; no files were changed.",
            body={"guidance": "Use `thoth init --migrate --preview` to inspect, or `thoth init --migrate --apply` to apply."},
            checks=[{"name": "explicit_mutation_required", "ok": False, "detail": "--preview or --apply missing"}],
        )
        return 2
    if getattr(args, "apply", False):
        result = initialize_project({}, project_root)
        print_envelope(
            command="doctor",
            status="ok",
            summary=f"Doctor fix applied migration {result['migration_id']}",
            body={"result": result},
            refs=output_refs(project_root / ".thoth" / "migrations" / result["migration_id"] / "apply.json"),
            checks=[{"name": "migration_applied", "ok": True, "detail": str(result["migration_id"])}],
        )
        return 0
    result = preview_project_migration({}, project_root)
    print_envelope(
        command="doctor",
        status="ok",
        summary=f"Doctor fix preview written for migration {result['migration_id']}; no authority files were changed.",
        body={"result": result},
        refs=output_refs(project_root / ".thoth" / "migrations" / result["migration_id"] / "preview.json"),
        checks=[{"name": "preview_only", "ok": True, "detail": str(result["migration_id"])}],
    )
    return 0


def handle_doctor(args, parser, *, project_root: Path) -> int:
    if getattr(args, "fix", False):
        return _handle_doctor_fix(args, parser, project_root=project_root)
    payload = build_doctor_payload(project_root)
    if args.json:
        print_envelope(command="doctor", status="ok" if payload.get("overall_ok") else "failed", summary="Doctor checks completed", body={"doctor": payload}, refs=output_refs(project_root / ".thoth" / "docs" / "object-graph-summary.json"), checks=payload.get("checks") if isinstance(payload.get("checks"), list) else [])
    else:
        print(render_doctor_text(payload), end="")
    return 0 if payload.get("overall_ok") else 1


def handle_dashboard(args, parser, *, project_root: Path) -> int:
    result = manage_dashboard(project_root, getattr(args, "action", "start"))
    print_envelope(command="dashboard", status=result["status"], summary=result["summary"], body=result, refs=output_refs(project_root / ".thoth" / "derived" / "dashboard.pid"), checks=[{"name": f"dashboard_{result['action']}", "ok": result["status"] == "ok"}])
    return 0


def handle_report(args, parser, *, project_root: Path) -> int:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=7)
    output_path = generate_default_report(project_root, start.isoformat(), end.isoformat(), fmt=getattr(args, "format", "md"))
    print_envelope(command="report", status="ok", summary=render_report_summary(output_path), body={"output_path": str(output_path)}, refs=output_refs(output_path))
    return 0
