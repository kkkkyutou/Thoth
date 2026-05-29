"""CLI entry for `thoth tui`."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .metrics import DEFAULT_GLOBAL_MAX_POINTS, DEFAULT_LOCAL_WINDOW_STEPS
from .snapshot import build_snapshot


def build_parser(prog: str = "thoth tui") -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog=prog, description="Read-only Thoth terminal dashboard.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--snapshot-json", action="store_true")
    parser.add_argument("--export-snapshots", action="store_true")
    parser.add_argument("--snapshot-dir", default="tools/tui/snapshots")
    parser.add_argument("--refresh", type=float, default=1.0)
    parser.add_argument("--metrics-refresh", type=float)
    parser.add_argument("--runs-refresh", type=float)
    parser.add_argument("--gpu-refresh", type=float)
    parser.add_argument("--ui-frame", type=float)
    parser.add_argument("--metrics-max-records", type=int, default=200000)
    parser.add_argument("--local-window-steps", type=int, default=DEFAULT_LOCAL_WINDOW_STEPS)
    parser.add_argument("--global-max-points", type=int, default=DEFAULT_GLOBAL_MAX_POINTS)
    parser.add_argument("--decimal-places", type=int, default=5)
    parser.add_argument("--no-python-plugins", action="store_true")
    parser.add_argument("--no-gpu", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    project_root = Path(args.project_root).resolve()
    if args.snapshot_json:
        payload = build_snapshot(
            project_root=project_root,
            no_gpu=args.no_gpu,
            metrics_max_records=args.metrics_max_records,
            no_python_plugins=args.no_python_plugins,
            local_window_steps=args.local_window_steps,
            global_max_points=args.global_max_points,
            decimal_places=args.decimal_places,
        )
        try:
            sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
            sys.stdout.write("\n")
        except BrokenPipeError:
            try:
                sys.stdout.close()
            finally:
                os._exit(0)
        return 0
    if args.export_snapshots:
        from .visual_snapshots import export_visual_snapshots

        payload = export_visual_snapshots(args.snapshot_dir, project_root=project_root, no_gpu=args.no_gpu)
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    try:
        from .app import ThothTuiApp
    except Exception as exc:
        print(f"Textual UI dependencies are missing: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    app = ThothTuiApp(
        project_root=project_root,
        no_gpu=args.no_gpu,
        refresh_seconds=args.refresh,
        metrics_refresh_seconds=args.metrics_refresh,
        runs_refresh_seconds=args.runs_refresh,
        gpu_refresh_seconds=args.gpu_refresh,
        ui_frame_seconds=args.ui_frame,
        metrics_max_records=args.metrics_max_records,
        no_python_plugins=args.no_python_plugins,
        local_window_steps=args.local_window_steps,
        global_max_points=args.global_max_points,
        decimal_places=args.decimal_places,
    )
    app.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
