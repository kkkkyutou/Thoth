"""Observe/read public commands."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from thoth.projections import PLUGIN_VERSION
from thoth.observe.dashboard import manage_dashboard
from thoth.observe.experiments import (
    ExperimentError,
    ExperimentFilters,
    attach_source,
    detach_source,
    discover_experiments,
    experiment_detail,
    list_experiments,
    read_experiment,
    register_experiment,
    select_experiment,
    update_experiment,
    validate_experiments,
)
from thoth.observe.extension_service import create_extension, list_extensions, validate_extensions
from thoth.observe.report import generate_default_report, render_report_summary
from thoth.observe.status import render_status
from thoth.init.service import initialize_project, preview_project_migration
from thoth.plan.doctor import build_doctor_payload, render_doctor_text
from thoth.run.status import build_status_payload
from thoth.surface.envelope import output_refs, print_envelope
from thoth.tui.cli import main as tui_main


def _normalize_preview_apply(args, flag_name: str, parser, command_name: str) -> None:
    action = getattr(args, flag_name, False)
    if action in {"preview", "apply"}:
        setattr(args, action, True)
    if getattr(args, "preview", False) and getattr(args, "apply", False):
        parser.exit(2, f"thoth: error: {command_name} accepts only one of preview or apply.\n")


def _mtime_iso(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _last_install_or_upgrade_time() -> str:
    candidates: list[Path] = []
    for key in ("THOTH_CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "THOTH_PLUGIN_ROOT"):
        value = os.environ.get(key)
        if value:
            candidates.append(Path(value))
    repo_root = Path(__file__).resolve().parents[2]
    candidates.extend(
        [
            repo_root / ".claude-plugin" / "plugin.json",
            repo_root / ".codex-plugin" / "plugin.json",
            repo_root / "pyproject.toml",
        ]
    )
    existing = [path for path in candidates if path.exists()]
    if not existing:
        return "unknown"
    latest = max(existing, key=lambda path: path.stat().st_mtime)
    return _mtime_iso(latest)


def render_version_probe() -> str:
    return f"version={PLUGIN_VERSION}\nlast_updated={_last_install_or_upgrade_time()}\n"


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
    _normalize_preview_apply(args, "fix", parser, "doctor --fix")
    if not getattr(args, "preview", False) and not getattr(args, "apply", False):
        print_envelope(
            command="doctor",
            status="needs_input",
            summary="Doctor fix requires explicit --preview or --apply; no files were changed.",
            body={"guidance": "Use `thoth init --migrate preview` to inspect, or `thoth init --migrate apply` to apply."},
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
    if getattr(args, "version", False):
        print(render_version_probe(), end="")
        return 0
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


def handle_tui(args, parser, *, project_root: Path) -> int:
    argv = ["--project-root", str(getattr(args, "tui_project_root", None) or project_root)]
    if getattr(args, "snapshot_json", False):
        argv.append("--snapshot-json")
    if getattr(args, "export_snapshots", False):
        argv.append("--export-snapshots")
    if getattr(args, "snapshot_dir", None):
        argv.extend(["--snapshot-dir", str(args.snapshot_dir)])
    if getattr(args, "refresh", None) is not None:
        argv.extend(["--refresh", str(args.refresh)])
    if getattr(args, "metrics_refresh", None) is not None:
        argv.extend(["--metrics-refresh", str(args.metrics_refresh)])
    if getattr(args, "runs_refresh", None) is not None:
        argv.extend(["--runs-refresh", str(args.runs_refresh)])
    if getattr(args, "gpu_refresh", None) is not None:
        argv.extend(["--gpu-refresh", str(args.gpu_refresh)])
    if getattr(args, "ui_frame", None) is not None:
        argv.extend(["--ui-frame", str(args.ui_frame)])
    if getattr(args, "metrics_max_records", None) is not None:
        argv.extend(["--metrics-max-records", str(args.metrics_max_records)])
    if getattr(args, "local_window_steps", None) is not None:
        argv.extend(["--local-window-steps", str(args.local_window_steps)])
    if getattr(args, "global_max_points", None) is not None:
        argv.extend(["--global-max-points", str(args.global_max_points)])
    if getattr(args, "decimal_places", None) is not None:
        argv.extend(["--decimal-places", str(args.decimal_places)])
    if getattr(args, "no_python_plugins", False):
        argv.append("--no-python-plugins")
    if getattr(args, "no_gpu", False):
        argv.append("--no-gpu")
    return tui_main(argv)


def _load_json_file(path: str | None) -> dict:
    if not path:
        return {}
    payload = __import__("json").loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("spec file must contain a JSON object")
    return payload


def _experiment_spec_from_args(args) -> dict:
    payload = _load_json_file(getattr(args, "spec", None))
    experiment_id = getattr(args, "experiment_id", None)
    if experiment_id:
        payload["experiment_id"] = experiment_id
    for attr, key in (
        ("title", "title"),
        ("description", "description"),
        ("status", "status"),
        ("work_id", "work_id"),
        ("run_id", "run_id"),
        ("controller_id", "controller_id"),
    ):
        value = getattr(args, attr, None)
        if value not in (None, "", []):
            payload[key] = value
    tags = getattr(args, "tags", None)
    if tags is not None:
        payload["tags"] = tags
    return payload


def _source_spec_from_args(args) -> dict:
    payload = _load_json_file(getattr(args, "spec", None))
    source_id = getattr(args, "source_id", None)
    if source_id:
        payload["id"] = source_id
    for attr, key in (
        ("channel", "channel"),
        ("source_type", "type"),
        ("path", "path"),
        ("glob", "glob"),
        ("series", "series"),
        ("title", "title"),
    ):
        value = getattr(args, attr, None)
        if value not in (None, "", []):
            payload[key] = value
    return payload


def handle_extension(args, parser, *, project_root: Path) -> int:
    action = getattr(args, "extension_action", "")
    if action == "create":
        try:
            result = create_extension(
                project_root,
                plugin_id=args.extension_id,
                title=getattr(args, "title", None),
                version=getattr(args, "version", "0.1.0"),
                surfaces=getattr(args, "surfaces", None),
                capabilities=getattr(args, "capabilities", None),
                source=getattr(args, "source", None),
                description=getattr(args, "description", ""),
                enabled=not getattr(args, "disabled", False),
                trusted=getattr(args, "trusted", False),
                force=getattr(args, "force", False),
            )
        except ValueError as exc:
            print_envelope(
                command="extension",
                status="failed",
                summary=str(exc),
                body={"action": "create", "error": str(exc)},
                checks=[{"name": "extension_create", "ok": False, "detail": str(exc)}],
            )
            return 2
        print_envelope(
            command="extension",
            status="ok",
            summary=f"Extension {result['extension']['id']} created.",
            body={"extension": result},
            refs=output_refs(project_root / ".thoth" / "extensions" / "manifest.json"),
            checks=[{"name": "extension_create", "ok": True, "detail": result["extension"]["id"]}],
        )
        return 0
    if action == "list":
        summary = list_extensions(project_root)
        print_envelope(
            command="extension",
            status="ok",
            summary=f"Loaded {summary.get('plugin_count', 0)} extension(s).",
            body={"extensions": summary},
            refs=output_refs(project_root / ".thoth" / "extensions" / "manifest.json"),
            checks=[{"name": "extension_list", "ok": True, "detail": str(summary.get("plugin_count", 0))}],
        )
        return 0
    if action == "validate":
        result = validate_extensions(project_root, fix=getattr(args, "fix", False))
        ok = result["status"] == "ok"
        print_envelope(
            command="extension",
            status=result["status"],
            summary="Extension manifest validation passed." if ok else "Extension manifest validation failed.",
            body={"validation": result},
            refs=output_refs(project_root / ".thoth" / "extensions" / "manifest.json"),
            checks=[{"name": "extension_validate", "ok": ok, "detail": "; ".join(result.get("errors") or [])}],
        )
        return 0 if ok else 1
    if action == "experiment":
        return handle_extension_experiment(args, parser, project_root=project_root)
    parser.error("extension requires create, list, validate, or experiment")
    return 2


def handle_extension_experiment(args, parser, *, project_root: Path) -> int:
    action = getattr(args, "experiment_action", "")
    try:
        if action == "register":
            spec = _experiment_spec_from_args(args)
            result = register_experiment(
                project_root,
                spec,
                actor=getattr(args, "actor", ""),
                source=getattr(args, "source", "cli"),
                surface=getattr(args, "surface", "cli"),
                upsert=getattr(args, "upsert", False),
            )
            print_envelope(
                command="extension experiment register",
                status="ok",
                summary=f"Experiment {result['experiment']['experiment_id']} registered.",
                body=result,
                refs=output_refs(project_root / ".thoth" / "objects" / "experiment" / f"{result['experiment']['experiment_id']}.json"),
                checks=[{"name": "experiment_register", "ok": True, "detail": result["experiment"]["experiment_id"]}],
            )
            return 0
        if action == "update":
            updates = _experiment_spec_from_args(args)
            result = update_experiment(project_root, args.experiment_id, updates, actor=getattr(args, "actor", ""))
            print_envelope(command="extension experiment update", status="ok", summary=f"Experiment {args.experiment_id} updated.", body=result, checks=[{"name": "experiment_update", "ok": True, "detail": args.experiment_id}])
            return 0
        if action == "attach-source":
            result = attach_source(project_root, args.experiment_id, _source_spec_from_args(args), actor=getattr(args, "actor", ""))
            print_envelope(command="extension experiment attach-source", status="ok", summary=f"Source attached to {args.experiment_id}.", body=result, checks=[{"name": "experiment_attach_source", "ok": True, "detail": args.experiment_id}])
            return 0
        if action == "detach-source":
            result = detach_source(project_root, args.experiment_id, args.source_id, actor=getattr(args, "actor", ""))
            print_envelope(command="extension experiment detach-source", status="ok", summary=f"Source detached from {args.experiment_id}.", body=result, checks=[{"name": "experiment_detach_source", "ok": True, "detail": args.experiment_id}])
            return 0
        if action == "list":
            result = list_experiments(
                project_root,
                ExperimentFilters(
                    search=getattr(args, "search", ""),
                    status=getattr(args, "status", ""),
                    tag=getattr(args, "tag", ""),
                    provider=getattr(args, "provider", ""),
                    limit=getattr(args, "limit", 100),
                    offset=getattr(args, "offset", 0),
                ),
            )
            print_envelope(command="extension experiment list", status="ok", summary=f"Loaded {result['total']} experiment(s).", body={"experiments": result}, checks=[{"name": "experiment_list", "ok": True, "detail": str(result["total"])}])
            return 0
        if action == "show":
            result = experiment_detail(project_root, args.experiment_id)
            print_envelope(command="extension experiment show", status="ok", summary=f"Loaded experiment {args.experiment_id}.", body=result, checks=[{"name": "experiment_show", "ok": True, "detail": args.experiment_id}])
            return 0
        if action == "select":
            result = select_experiment(project_root, args.experiment_id, series_id=getattr(args, "series", None))
            print_envelope(command="extension experiment select", status="ok", summary=f"Selected experiment {args.experiment_id}.", body=result, refs=output_refs(project_root / ".thoth" / "local" / "experiments" / "selection.json"), checks=[{"name": "experiment_select", "ok": True, "detail": args.experiment_id}])
            return 0
        if action == "validate":
            result = validate_experiments(project_root)
            ok = result["status"] == "ok"
            print_envelope(command="extension experiment validate", status=result["status"], summary="Experiment registry validation passed." if ok else "Experiment registry validation failed.", body={"validation": result}, checks=[{"name": "experiment_validate", "ok": ok, "detail": "; ".join(result.get("errors") or [])}])
            return 0 if ok else 1
        if action == "discover":
            result = discover_experiments(project_root)
            print_envelope(command="extension experiment discover", status="ok", summary=f"Discovered {len(result.get('candidates', []))} unregistered experiment candidate(s).", body={"discovery": result}, checks=[{"name": "experiment_discover", "ok": True, "detail": str(len(result.get("candidates", [])))}])
            return 0
    except (ExperimentError, ValueError, FileNotFoundError) as exc:
        print_envelope(
            command=f"extension experiment {action}",
            status="failed",
            summary=str(exc),
            body={"error": str(exc), "action": action},
            checks=[{"name": f"experiment_{action.replace('-', '_')}", "ok": False, "detail": str(exc)}],
        )
        return 2
    parser.error("extension experiment requires a supported action")
    return 2


def handle_report(args, parser, *, project_root: Path) -> int:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=7)
    output_path = generate_default_report(project_root, start.isoformat(), end.isoformat(), fmt=getattr(args, "format", "md"))
    print_envelope(command="report", status="ok", summary=render_report_summary(output_path), body={"output_path": str(output_path)}, refs=output_refs(output_path))
    return 0
