"""Tests for extension-backed observe providers and the TUI snapshot surface."""

from __future__ import annotations

import json
import asyncio
import shutil
import time
from pathlib import Path

from thoth.observe.extensions import (
    ensure_extension_manifest,
    extension_summary,
    manifest_validation_errors,
    metrics_plugin_configs,
)
from thoth.observe.actions import action_catalog, ensure_action_token, run_observe_action, validate_action_token
from thoth.observe.plugin_service import create_plugin, validate_plugins
from thoth.observe.providers import observe_snapshot
from thoth.tui.app import ThothTuiApp
from thoth.tui.chart import render_connected_chart
from thoth.tui.metrics import MetricFileState, MetricRecord, downsample_minmax, ema, parse_metric_line, sparkline, summarize_metrics
from thoth.tui.plugin_api import load_tui_python_plugins
from thoth.tui.snapshot import build_snapshot
from thoth.tui.visual_snapshots import export_visual_snapshots


ROOT = Path(__file__).parent.parent.parent
DEMO = ROOT / "tests" / "fixtures" / "dashboard_demo"


def test_extension_manifest_default_is_portable(tmp_path):
    manifest = ensure_extension_manifest(tmp_path)

    assert manifest["schema_version"] == 2
    assert manifest["kind"] == "thoth.extensions"
    assert manifest["actions"] == []
    assert (tmp_path / ".thoth" / "extensions" / "manifest.json").exists()
    assert (tmp_path / ".thoth" / "extensions" / "plugins").is_dir()
    assert metrics_plugin_configs(tmp_path) == []
    assert extension_summary(tmp_path)["metrics_configured"] is False


def test_extension_manifest_v1_is_migrated_by_managed_entrypoint(tmp_path):
    manifest_path = tmp_path / ".thoth" / "extensions" / "manifest.json"
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugins": [
                    {
                        "id": "metrics-demo",
                        "version": "1",
                        "enabled": True,
                        "surfaces": ["dashboard"],
                        "capabilities": ["metrics_provider"],
                        "source": ".thoth/extensions/plugins/metrics-demo",
                        "config": {"metrics_files": "metrics.jsonl"},
                    }
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    manifest = ensure_extension_manifest(tmp_path)

    assert manifest["schema_version"] == 2
    assert manifest["plugins"][0]["id"] == "metrics-demo"
    assert manifest["last_migration"]["from_schema_version"] == 1
    assert manifest_path.with_suffix(".json.v1.bak").exists()


def test_extension_manifest_reports_duplicate_plugin_ids(tmp_path):
    ensure_extension_manifest(tmp_path)
    manifest_path = tmp_path / ".thoth" / "extensions" / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schema_version": 2,
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


def test_plugin_create_and_validate_write_local_receipts(tmp_path):
    result = create_plugin(
        tmp_path,
        plugin_id="demo-tool",
        title="Demo Tool",
        surfaces="dashboard,tui",
        capabilities="tool,metrics_provider",
    )

    assert result["plugin"]["id"] == "demo-tool"
    assert (tmp_path / ".thoth" / "extensions" / "plugins" / "demo-tool" / "README.md").exists()
    assert result["receipt"]["path"].startswith(".thoth/local/actions/")

    validation = validate_plugins(tmp_path)

    assert validation["status"] == "ok"
    assert validation["errors"] == []
    assert validation["receipt"]["path"].startswith(".thoth/local/actions/")
    summary = extension_summary(tmp_path)
    assert summary["enabled_plugin_count"] == 1
    assert summary["debug"]["plugin_ids"] == ["demo-tool"]


def test_observe_action_catalog_includes_shared_low_risk_actions(tmp_path):
    actions = {item["id"]: item for item in action_catalog()}

    assert {"refresh", "attach", "watch", "stop", "validate", "sync", "health-check"} <= set(actions)
    assert actions["refresh"]["confirmation_required"] is False
    assert actions["health-check"]["confirmation_required"] is False
    assert actions["stop"]["confirmation_required"] is True
    assert actions["validate"]["confirmation_required"] is True
    assert actions["sync"]["confirmation_required"] is True

    preview = run_observe_action(tmp_path, "sync", confirmed=False)

    assert preview["status"] == "confirm_required"
    assert preview["body"]["recommended_command"] == "thoth init --sync"
    assert not (tmp_path / ".thoth" / "local" / "actions").exists()


def test_dashboard_action_token_is_local_and_validated(tmp_path):
    token = ensure_action_token(tmp_path)

    assert len(token) >= 24
    assert (tmp_path / ".thoth" / "local" / "dashboard" / "action-token").exists()
    assert validate_action_token(tmp_path, token) is True
    assert validate_action_token(tmp_path, "wrong-token") is False


def test_metrics_parser_and_smoothing_helpers():
    row = parse_metric_line('{"step":3,"split":"train","metrics":{"loss_total":2.5},"lr":0.1}')

    assert row is not None
    assert row.step == 3
    assert row.metrics["loss_total"] == 2.5
    assert row.metrics["lr"] == 0.1
    assert ema([3.0, 2.0, 1.0], span=2)[-1] < 2.0
    assert len(sparkline([3.0, 2.5, 2.0], width=8)) == 3


def test_incremental_metric_tailer_handles_append_and_truncate(tmp_path):
    path = tmp_path / "metrics.jsonl"
    path.write_text(json.dumps({"step": 1, "metrics": {"loss": 2.0}}) + "\n", encoding="utf-8")
    state = MetricFileState(path)

    assert [record.step for record in state.tail()] == [1]

    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"step": 2, "metrics": {"loss": 1.0}}) + "\n")
    assert [record.step for record in state.tail()] == [1, 2]

    path.write_text(json.dumps({"step": 5, "metrics": {"loss": 0.5}}) + "\n", encoding="utf-8")
    assert [record.step for record in state.tail()] == [5]


def test_incremental_metric_tailer_keeps_partial_line(tmp_path):
    path = tmp_path / "metrics.jsonl"
    prefix = '{"step": 1, "metrics": {"loss": '
    path.write_text(prefix, encoding="utf-8")
    state = MetricFileState(path)

    assert state.tail() == []

    with path.open("a", encoding="utf-8") as handle:
        handle.write("1.5}}\n")
    records = state.tail()

    assert [record.step for record in records] == [1]
    assert records[0].metrics["loss"] == 1.5


def test_metric_history_has_local_global_views_and_spike_preservation():
    records = []
    for step in range(1, 2001):
        value = 4.0 / step
        if step == 777:
            value = 9.0
        records.append(MetricRecord(step=step, split="train", metrics={"loss_total": value}))

    summary = summarize_metrics(records, local_window_steps=1000, global_max_points=80)
    metric = next(item for item in summary["metrics"] if item["name"] == "train.loss_total")
    history = metric["history"]

    assert history["local"]["steps"][0] == 1001
    assert history["local"]["steps"][-1] == 2000
    assert history["global"]["steps"][0] == 1
    assert history["global"]["steps"][-1] == 2000
    assert len(history["global"]["steps"]) <= 80
    assert 9.0 in history["global"]["raw"]


def test_minmax_downsample_keeps_endpoint_and_bounds():
    steps = list(range(100))
    raw = [1.0 for _ in steps]
    raw[45] = 10.0
    sampled = downsample_minmax(steps, raw, ema(raw), max_points=20)

    assert sampled["steps"][0] == 0
    assert sampled["steps"][-1] == 99
    assert len(sampled["steps"]) <= 20
    assert 10.0 in sampled["raw"]


def test_connected_chart_renderer_draws_braille_and_legend():
    text = render_connected_chart(
        metric_name="train.loss_total",
        scope="local",
        steps=list(range(1, 80)),
        raw=[2.0 / step for step in range(1, 80)],
        smooth=ema([2.0 / step for step in range(1, 80)]),
        width=80,
        height=8,
        show_smooth=True,
        places=5,
    )

    assert "raw" in text.plain
    assert "EMA" in text.plain
    assert any(0x2800 <= ord(char) <= 0x28FF for char in text.plain)


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
    assert snapshot["tui"]["renderer_executed"] is False


def test_tui_python_plugin_loader_requires_trusted_true(tmp_path):
    ensure_extension_manifest(tmp_path)
    plugin_root = tmp_path / ".thoth" / "extensions" / "plugins" / "sample"
    plugin_root.mkdir(parents=True)
    (plugin_root / "plugin.py").write_text(
        "def register(registry):\n"
        "    raise AssertionError('untrusted plugin should not execute')\n",
        encoding="utf-8",
    )
    (tmp_path / ".thoth" / "extensions" / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugins": [
                    {
                        "id": "sample",
                        "version": "1",
                        "enabled": True,
                        "surfaces": ["tui"],
                        "capabilities": ["tui_python_plugin"],
                        "source": ".thoth/extensions/plugins/sample",
                        "config": {"entrypoint": "plugin.py"},
                    }
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    result = load_tui_python_plugins(tmp_path)

    assert result.panels == ()
    assert "trusted=true" in result.notices[0]["message"]


def test_tui_python_plugin_loader_rejects_entrypoint_escape(tmp_path):
    ensure_extension_manifest(tmp_path)
    plugin_root = tmp_path / ".thoth" / "extensions" / "plugins" / "sample"
    plugin_root.mkdir(parents=True)
    (tmp_path / ".thoth" / "extensions" / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugins": [
                    {
                        "id": "sample",
                        "version": "1",
                        "enabled": True,
                        "trusted": True,
                        "surfaces": ["tui"],
                        "capabilities": ["tui_python_plugin"],
                        "source": ".thoth/extensions/plugins/sample",
                        "config": {"entrypoint": "../escape.py"},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = load_tui_python_plugins(tmp_path)

    assert result.panels == ()
    assert "escapes" in result.notices[0]["message"]


def test_tui_python_plugin_loader_loads_trusted_panel(tmp_path):
    ensure_extension_manifest(tmp_path)
    plugin_root = tmp_path / ".thoth" / "extensions" / "plugins" / "sample"
    plugin_root.mkdir(parents=True)
    (plugin_root / "plugin.py").write_text(
        "from thoth.tui.plugin_api import TuiPanelSpec\n"
        "class Provider:\n"
        "    def __init__(self, context):\n"
        "        self.context = context\n"
        "    def refresh(self, previous=None):\n"
        "        return {'rows': [self.context.plugin_id]}\n"
        "class Renderer:\n"
        "    def __init__(self, context):\n"
        "        self.context = context\n"
        "    def render(self, state, ui_state, size=None):\n"
        "        return 'sample render'\n"
        "def register(registry):\n"
        "    registry.register_panel(TuiPanelSpec(id='panel', title='Panel', provider_factory=Provider, renderer_factory=Renderer))\n",
        encoding="utf-8",
    )
    (tmp_path / ".thoth" / "extensions" / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugins": [
                    {
                        "id": "sample",
                        "version": "1",
                        "enabled": True,
                        "trusted": True,
                        "surfaces": ["tui"],
                        "capabilities": ["tui_python_plugin"],
                        "source": ".thoth/extensions/plugins/sample",
                        "config": {"entrypoint": "plugin.py"},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = load_tui_python_plugins(tmp_path)

    assert [panel.spec.id for panel in result.panels] == ["panel"]
    assert result.notices[-1]["message"] == "Python TUI plugin loaded."


def test_tui_plugin_slow_renderer_warns_and_continues(tmp_path):
    ensure_extension_manifest(tmp_path)
    plugin_root = tmp_path / ".thoth" / "extensions" / "plugins" / "slow"
    plugin_root.mkdir(parents=True)
    (plugin_root / "plugin.py").write_text(
        "import time\n"
        "from rich.panel import Panel\n"
        "from thoth.tui.plugin_api import TuiPanelSpec\n"
        "class Renderer:\n"
        "    def __init__(self, context):\n"
        "        self.context = context\n"
        "    def render(self, state, ui_state, size=None):\n"
        "        time.sleep(0.01)\n"
        "        return Panel('slow but alive')\n"
        "def register(registry):\n"
        "    registry.register_panel(TuiPanelSpec(id='panel', title='Slow', renderer_factory=Renderer, render_budget_ms=1.0))\n",
        encoding="utf-8",
    )
    (tmp_path / ".thoth" / "extensions" / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugins": [
                    {
                        "id": "slow",
                        "version": "1",
                        "enabled": True,
                        "trusted": True,
                        "surfaces": ["tui"],
                        "capabilities": ["tui_python_plugin"],
                        "source": ".thoth/extensions/plugins/slow",
                        "config": {"entrypoint": "plugin.py"},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    app = ThothTuiApp(
        project_root=tmp_path,
        no_gpu=True,
        refresh_seconds=60.0,
        metrics_max_records=1000,
    )
    app.refresh_plugin_metadata()

    renderables = app._render_plugin_panels()

    assert len(renderables) == 1
    assert any("exceeded budget" in notice["message"] for notice in app._python_plugin_notices)


def test_tui_action_layer_p95_under_30ms_without_provider_refresh(monkeypatch, tmp_path):
    calls = {"metrics": 0, "runs": 0, "gpu": 0}
    app = ThothTuiApp(
        project_root=tmp_path,
        no_gpu=True,
        refresh_seconds=60.0,
        metrics_max_records=1000,
    )
    records = [MetricRecord(step=step, split="train", metrics={"loss": 1.0 / step}) for step in range(1, 2500)]
    app.providers = {
        "metrics": summarize_metrics(records),
        "runs": {"runs": [{"run_id": f"run-{index}", "work_id": "W", "status": "running"} for index in range(200)]},
        "work_items": {"work_items": [{"work_id": f"W{index}", "status": "ready"} for index in range(200)]},
    }
    app.snapshot = {"providers": app.providers, "metrics": app.providers["metrics"], "gpu": {"gpus": []}}
    monkeypatch.setattr(app, "request_render", lambda: None)
    monkeypatch.setattr(app, "refresh_metrics", lambda: calls.__setitem__("metrics", calls["metrics"] + 1))
    monkeypatch.setattr(app, "refresh_runs", lambda: calls.__setitem__("runs", calls["runs"] + 1))
    monkeypatch.setattr(app, "refresh_gpu", lambda: calls.__setitem__("gpu", calls["gpu"] + 1))

    samples = []
    actions = (app.action_cursor_down, app.action_cursor_up, app.action_enter_detail, app.action_escape_detail)
    for index in range(400):
        started = time.perf_counter()
        actions[index % len(actions)]()
        samples.append((time.perf_counter() - started) * 1000.0)

    p95 = sorted(samples)[int(len(samples) * 0.95)]
    assert p95 < 30.0
    assert calls == {"metrics": 0, "runs": 0, "gpu": 0}


def test_textual_tui_keymap_smoke(tmp_path):
    asyncio.run(_run_textual_tui_keymap_smoke(tmp_path))


async def _run_textual_tui_keymap_smoke(tmp_path):
    app = ThothTuiApp(
        project_root=tmp_path,
        no_gpu=True,
        refresh_seconds=60.0,
        metrics_max_records=1000,
        no_python_plugins=True,
    )
    async with app.run_test(size=(120, 36)) as pilot:
        await pilot.pause()
        assert app.active_tab == "cockpit"
        await pilot.press("tab")
        await pilot.pause()
        assert app.active_tab == "loss"
        await pilot.press("shift+tab")
        await pilot.pause()
        assert app.active_tab == "cockpit"
        await pilot.press("tab")
        await pilot.pause()
        assert app.active_tab == "loss"
        await pilot.press("down")
        await pilot.press("up")
        await pilot.press("enter")
        await pilot.pause()
        assert app.detail is True
        await pilot.press("s")
        await pilot.pause()
        assert app.show_smooth is False
        await pilot.press("d")
        await pilot.pause()
        assert app.decimal_places != 5
        await pilot.press("?")
        await pilot.pause()
        assert app.show_help is True
        await pilot.press("escape")
        await pilot.pause()
        assert app.show_help is False


def test_tui_key_actions_do_not_refresh_gpu_provider(monkeypatch, tmp_path):
    calls = {"gpu": 0}

    def fake_system_provider():
        calls["gpu"] += 1
        return {
            "schema_version": 1,
            "kind": "system",
            "gpu": {"schema_version": 1, "kind": "gpu", "available": False, "reason": "test", "gpus": []},
            "provider": {"last_refreshed_epoch": time.time(), "stale_seconds": 0.0, "last_error": None},
        }

    app = ThothTuiApp(
        project_root=tmp_path,
        no_gpu=False,
        refresh_seconds=60.0,
        runs_refresh_seconds=60.0,
        gpu_refresh_seconds=60.0,
        ui_frame_seconds=0.01,
        metrics_max_records=1000,
        no_python_plugins=True,
    )
    monkeypatch.setattr(app, "_build_system_provider", fake_system_provider)
    asyncio.run(_run_tui_key_actions_do_not_refresh_gpu(app, calls))


async def _run_tui_key_actions_do_not_refresh_gpu(app, calls):
    async with app.run_test(size=(120, 36)) as pilot:
        await pilot.pause()
        assert calls["gpu"] == 1
        await pilot.press("down")
        await pilot.press("up")
        await pilot.press("enter")
        await pilot.press("s")
        await pilot.press("d")
        await pilot.pause()
        assert calls["gpu"] == 1


def test_tui_visual_snapshot_export_writes_pngs(tmp_path):
    output = tmp_path / "shots"
    manifest = export_visual_snapshots(output, project_root=DEMO, no_gpu=True)

    paths = [Path(row["path"]) for row in manifest["snapshots"]]
    assert len(paths) >= 2
    assert all(path.exists() and path.stat().st_size > 1000 for path in paths)
