"""Tests for extension-backed observe providers and the TUI snapshot surface."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from thoth.observe.extensions import (
    ensure_extension_manifest,
    extension_summary,
    manifest_validation_errors,
    metrics_plugin_configs,
)
from thoth.observe.providers import observe_snapshot
from thoth.tui.metrics import ema, parse_metric_line, sparkline
from thoth.tui.snapshot import build_snapshot
from thoth.tui.visual_snapshots import export_visual_snapshots


ROOT = Path(__file__).parent.parent.parent
DEMO = ROOT / "tests" / "fixtures" / "dashboard_demo"


def test_extension_manifest_default_is_portable(tmp_path):
    manifest = ensure_extension_manifest(tmp_path)

    assert manifest["schema_version"] == 1
    assert (tmp_path / ".thoth" / "extensions" / "manifest.json").exists()
    assert (tmp_path / ".thoth" / "extensions" / "plugins").is_dir()
    assert metrics_plugin_configs(tmp_path) == []
    assert extension_summary(tmp_path)["metrics_configured"] is False


def test_extension_manifest_reports_duplicate_plugin_ids(tmp_path):
    ensure_extension_manifest(tmp_path)
    manifest_path = tmp_path / ".thoth" / "extensions" / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugins": [
                    {"id": "dup", "version": "1", "enabled": True, "surfaces": [], "capabilities": [], "source": "a", "config": {}},
                    {"id": "dup", "version": "2", "enabled": True, "surfaces": [], "capabilities": [], "source": "b", "config": {}},
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    assert "duplicate plugin id: dup" in manifest_validation_errors(tmp_path)
    assert extension_summary(tmp_path)["plugin_count"] == 1


def test_metrics_parser_and_smoothing_helpers():
    row = parse_metric_line('{"step":3,"split":"train","metrics":{"loss_total":2.5},"lr":0.1}')

    assert row is not None
    assert row.step == 3
    assert row.metrics["loss_total"] == 2.5
    assert row.metrics["lr"] == 0.1
    assert ema([3.0, 2.0, 1.0], span=2)[-1] < 2.0
    assert len(sparkline([3.0, 2.5, 2.0], width=8)) == 3


def test_demo_fixture_observe_snapshot_reads_metrics_and_runs():
    snapshot = observe_snapshot(DEMO)

    assert snapshot["providers"]["metrics"]["record_count"] >= 30
    assert snapshot["providers"]["metrics"]["configured"] is True
    assert snapshot["providers"]["work_items"]["status_counts"]["active"] == 1
    assert snapshot["providers"]["runs"]["run_count"] == 3
    assert snapshot["providers"]["plugins"]["enabled_plugin_count"] == 3
    assert snapshot["providers"]["plugins"]["system_configured"] is True
    assert snapshot["providers"]["system"]["configured"] is True
    assert snapshot["providers"]["system"]["gpu"]["gpus"][0]["name"] == "Demo Accelerator 0"


def test_tui_snapshot_json_is_ansi_free_and_contains_provider_metadata(tmp_path):
    project = tmp_path / "demo"
    shutil.copytree(DEMO, project)

    snapshot = build_snapshot(project_root=project, no_gpu=True)
    text = json.dumps(snapshot, ensure_ascii=False)

    assert "\x1b[" not in text
    assert snapshot["metrics"]["record_count"] >= 30
    assert snapshot["gpu"]["reason"] == "disabled"
    assert snapshot["providers"]["plugins"]["provider"]["last_error"] is None


def test_tui_visual_snapshot_export_writes_pngs(tmp_path):
    output = tmp_path / "shots"
    manifest = export_visual_snapshots(output, project_root=DEMO, no_gpu=True)

    paths = [Path(row["path"]) for row in manifest["snapshots"]]
    assert len(paths) >= 2
    assert all(path.exists() and path.stat().st_size > 1000 for path in paths)
