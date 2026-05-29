"""Rich renderables for the Thoth TUI."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from rich import box
from rich.align import Align
from rich.columns import Columns
from rich.console import Group
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .chart import MetricChart
from .metrics import selected_metric


THEME = {
    "red": "#d21f3c",
    "red_hot": "#ff4058",
    "white": "#f7f1e8",
    "ceramic": "#f4eee4",
    "muted": "#a99f99",
    "cyan": "#52f0ff",
    "amber": "#ffb454",
    "green": "#75b56b",
    "bg": "#080607",
}

TABS = ("loss", "runs", "authority", "gpu", "plugins")


def fmt(value: Any, places: int = 5) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.{places}f}"
    return str(value)


def frame(renderable: Any, title: str, *, subtitle: str = "", border: str | None = None) -> Panel:
    return Panel(
        renderable,
        title=f"[bold {THEME['red_hot']}]{title}[/]",
        subtitle=f"[{THEME['muted']}]{subtitle}[/]" if subtitle else "",
        border_style=border or THEME["red"],
        box=box.ROUNDED,
        padding=(0, 1),
    )


def _providers(snapshot: Mapping[str, Any]) -> Mapping[str, Any]:
    providers = snapshot.get("providers")
    return providers if isinstance(providers, Mapping) else {}


def _provider_age(payload: Mapping[str, Any]) -> str:
    provider = payload.get("provider") if isinstance(payload.get("provider"), Mapping) else {}
    stale = provider.get("stale_seconds")
    if isinstance(stale, (int, float)):
        return f"{stale:.1f}s"
    return "unknown"


def _metric_payload(snapshot: Mapping[str, Any]) -> Mapping[str, Any]:
    metrics = snapshot.get("metrics")
    return metrics if isinstance(metrics, Mapping) else {}


def _status_bar(snapshot: Mapping[str, Any], active_tab: str = "loss") -> Panel:
    project = (_providers(snapshot).get("project") or {}).get("project") if isinstance(_providers(snapshot).get("project"), Mapping) else {}
    metrics = _metric_payload(snapshot)
    runs = _providers(snapshot).get("runs") if isinstance(_providers(snapshot).get("runs"), Mapping) else {}
    gpu = snapshot.get("gpu") if isinstance(snapshot.get("gpu"), Mapping) else {}
    name = project.get("name") if isinstance(project, Mapping) else None
    generated = snapshot.get("generated_at") or ""
    line = Text()
    line.append(" THOTH TUI ", style=f"bold {THEME['red_hot']} on {THEME['bg']}")
    line.append(f" tab={active_tab}", style=THEME["white"])
    line.append(f" step={metrics.get('latest_step')}", style=THEME["white"])
    line.append(f" records={metrics.get('record_count', 0)}", style=THEME["muted"])
    line.append(f" active_runs={runs.get('active_count', 0)}", style=THEME["white"])
    line.append(f" gpu={'on' if gpu.get('available') else 'off'}", style=THEME["green"] if gpu.get("available") else THEME["amber"])
    line.append("  ")
    line.append(str(name or "Thoth"), style=THEME["ceramic"])
    line.append("  ")
    line.append(str(generated), style=THEME["muted"])
    return Panel(line, box=box.SQUARE, border_style=THEME["red"], padding=(0, 1))


def _authority_panel(snapshot: Mapping[str, Any]) -> Panel:
    authority = _providers(snapshot).get("authority") if isinstance(_providers(snapshot).get("authority"), Mapping) else {}
    summary = authority.get("summary") if isinstance(authority.get("summary"), Mapping) else {}
    table = Table.grid(expand=True)
    table.add_column(style=THEME["muted"])
    table.add_column(justify="right", style=THEME["white"])
    for key in ("work_item_counts", "decision_counts", "discussion_counts"):
        table.add_row(key, str(summary.get(key, {})))
    problems = authority.get("problems") or []
    table.add_row("problems", str(len(problems)))
    table.add_row("age", _provider_age(authority))
    return frame(table, "Authority", subtitle="object graph")


def _work_items_panel(snapshot: Mapping[str, Any], *, selected: int = 0, max_rows: int = 12) -> Panel:
    work = _providers(snapshot).get("work_items") if isinstance(_providers(snapshot).get("work_items"), Mapping) else {}
    rows = work.get("work_items") if isinstance(work.get("work_items"), list) else []
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Work", style=THEME["white"], no_wrap=True)
    table.add_column("Status", style=THEME["cyan"])
    table.add_column("Module", style=THEME["muted"])
    table.add_column("Goal", style=THEME["white"])
    if not rows:
        table.add_row("-", "empty", "-", "No work items found.")
    start = max(0, min(selected, max(0, len(rows) - max_rows)))
    for index, item in enumerate(rows[start : start + max_rows], start=start):
        style = f"bold {THEME['red_hot']}" if index == selected else THEME["white"]
        status = str(item.get("authority_status") or item.get("ready_state") or item.get("status") or "")
        table.add_row(
            f"[{style}]{item.get('work_id') or item.get('id') or ''}[/]",
            status,
            str(item.get("module") or ""),
            str(item.get("goal_statement") or item.get("title") or "")[:90],
        )
    return frame(table, f"Work Items ({work.get('count', 0)})", subtitle=f"age={_provider_age(work)}")


def _selected_row(rows: Sequence[Mapping[str, Any]], index: int) -> Mapping[str, Any] | None:
    if not rows:
        return None
    return rows[index % len(rows)]


def _runs_overview_panel(snapshot: Mapping[str, Any], *, selected: int = 0, max_rows: int = 14) -> Panel:
    runs = _providers(snapshot).get("runs") if isinstance(_providers(snapshot).get("runs"), Mapping) else {}
    rows = runs.get("runs") if isinstance(runs.get("runs"), list) else []
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Run", style=THEME["white"], no_wrap=True)
    table.add_column("Work", style=THEME["muted"])
    table.add_column("Status", style=THEME["cyan"])
    table.add_column("Phase", style=THEME["cyan"])
    table.add_column("Progress", justify="right", style=THEME["amber"])
    table.add_column("Message", style=THEME["white"])
    if not rows:
        table.add_row("-", "-", "idle", "-", "0%", "No run ledger found.")
    start = max(0, min(selected, max(0, len(rows) - max_rows)))
    for index, run in enumerate(rows[start : start + max_rows], start=start):
        style = f"bold {THEME['red_hot']}" if index == selected else THEME["white"]
        table.add_row(
            f"[{style}]{run.get('run_id') or ''}[/]",
            str(run.get("work_id") or ""),
            str(run.get("status") or ""),
            str(run.get("phase") or ""),
            f"{float(run.get('progress_pct') or 0):.0f}%",
            str(run.get("latest_message") or "")[:70],
        )
    return frame(_provider_error_wrap(table, runs), f"Runs ({runs.get('run_count', 0)})", subtitle=f"{runs.get('active_count', 0)} active")


def _run_detail_panel(snapshot: Mapping[str, Any], *, selected: int = 0) -> Panel:
    runs = _providers(snapshot).get("runs") if isinstance(_providers(snapshot).get("runs"), Mapping) else {}
    rows = runs.get("runs") if isinstance(runs.get("runs"), list) else []
    run = _selected_row(rows, selected)
    if run is None:
        return frame("No selected run.", "Run Detail", border=THEME["amber"])
    grid = Table.grid(expand=True)
    grid.add_column(ratio=1, style=THEME["muted"])
    grid.add_column(ratio=3, style=THEME["white"])
    for key in ("run_id", "work_id", "title", "host", "executor", "status", "phase", "progress_pct", "attachable", "supervisor_state", "last_heartbeat_at", "updated_at", "artifact_count"):
        grid.add_row(key, str(run.get(key) if run.get(key) is not None else "-"))
    events = run.get("events") if isinstance(run.get("events"), list) else []
    if events:
        grid.add_row("events", "")
        for event in events[-8:]:
            grid.add_row(str(event.get("seq") or ""), str(event.get("message") or event)[:120])
    return frame(grid, f"Run Detail :: {run.get('run_id')}", subtitle="Esc back")


def _provider_error_wrap(renderable: Any, payload: Mapping[str, Any]) -> Any:
    provider = payload.get("provider") if isinstance(payload.get("provider"), Mapping) else {}
    last_error = provider.get("last_error")
    errors = payload.get("provider_errors")
    if not last_error and not errors:
        return renderable
    group_items = [renderable]
    if last_error:
        group_items.append(Text(f"provider error: {last_error}", style=THEME["amber"]))
    if isinstance(errors, list):
        for error in errors[:4]:
            group_items.append(Text(str(error), style=THEME["amber"]))
    return Group(*group_items)


def _loss_table_panel(snapshot: Mapping[str, Any], *, selected: int = 0, places: int = 5, max_rows: int = 14) -> Panel:
    metrics = _metric_payload(snapshot)
    rows = metrics.get("metrics") if isinstance(metrics.get("metrics"), list) else []
    if not metrics.get("configured"):
        return frame(
            Text(str(metrics.get("message") or "No metrics provider configured."), style=THEME["muted"]),
            "Loss / Metrics",
            subtitle="extension manifest required",
            border=THEME["amber"],
        )
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Metric", style=THEME["white"])
    table.add_column("Current", justify="right", style=THEME["cyan"])
    table.add_column("EMA", justify="right", style=THEME["red_hot"])
    table.add_column("Mean50", justify="right", style=THEME["white"])
    table.add_column("Trend", style=THEME["amber"])
    table.add_column("Points", justify="right", style=THEME["muted"])
    table.add_column("Spark", style=THEME["white"])
    if not rows:
        table.add_row("no metrics", "-", "-", "-", "-", "0", "configured provider has no records")
    start = max(0, min(selected, max(0, len(rows) - max_rows)))
    for index, row in enumerate(rows[start : start + max_rows], start=start):
        style = f"bold {THEME['red_hot']}" if index == selected else THEME["white"]
        table.add_row(
            f"[{style}]{row.get('name') or ''}[/]",
            fmt(row.get("current"), places),
            fmt(row.get("ema_current"), places),
            fmt(row.get("mean_50"), places),
            str(row.get("trend") or ""),
            str(row.get("points", 0)),
            str(row.get("sparkline") or ""),
        )
    source_files = metrics.get("source_files") if isinstance(metrics.get("source_files"), list) else []
    subtitle = str(source_files[0]) if source_files else str(metrics.get("run_name") or "extension metrics")
    return frame(_provider_error_wrap(table, metrics), f"Loss / Metrics ({metrics.get('record_count', 0)} records)", subtitle=subtitle)


def _metric_history_meta(metric: Mapping[str, Any]) -> Mapping[str, Any]:
    history = metric.get("history") if isinstance(metric.get("history"), Mapping) else {}
    meta = history.get("meta") if isinstance(history.get("meta"), Mapping) else {}
    return meta


def _metric_detail_panel(snapshot: Mapping[str, Any], *, selected: int = 0, places: int = 5, show_smooth: bool = True) -> Group:
    metrics = _metric_payload(snapshot)
    metric = selected_metric(metrics, selected)
    if metric is None:
        return Group(frame("No selected metric.", "Metric Detail", border=THEME["amber"]))
    stats = Table.grid(expand=True)
    stats.add_column(ratio=1)
    stats.add_column(ratio=1)
    stats.add_column(ratio=1)
    stats.add_column(ratio=1)
    stats.add_row(
        f"cur={fmt(metric.get('current'), places)}",
        f"ema={fmt(metric.get('ema_current'), places)}",
        f"min={fmt(metric.get('min'), places)}",
        f"max={fmt(metric.get('max'), places)}",
    )
    stats.add_row(
        f"mean50={fmt(metric.get('mean_50'), places)}",
        f"mean150={fmt(metric.get('mean_150'), places)}",
        f"mean1000={fmt(metric.get('mean_1000'), places)}",
        f"spike={fmt(metric.get('recent_spike'), places)}",
    )
    meta = _metric_history_meta(metric)
    smooth_mode = "EMA emphasized" if show_smooth else "EMA muted"
    stats_panel = frame(
        stats,
        f"Metric Detail :: {metric.get('name')}",
        subtitle=f"step {meta.get('first_step', '-')} -> {meta.get('latest_step', '-')}  raw_points={meta.get('raw_points', metric.get('points', 0))}  {smooth_mode}",
    )
    local_panel = frame(
        MetricChart(metric, scope="local", height=10, show_smooth=show_smooth, places=places),
        "Local Window",
        subtitle=f"last {meta.get('local_window_steps', 1000)} steps, {meta.get('local_points', 0)} plotted points",
    )
    global_panel = frame(
        MetricChart(metric, scope="global", height=12, show_smooth=show_smooth, places=places),
        "Global Run",
        subtitle=f"start to current, {meta.get('global_points', 0)} plotted points",
    )
    return Group(stats_panel, local_panel, global_panel)


def _gpu_panel(snapshot: Mapping[str, Any]) -> Panel:
    gpu = snapshot.get("gpu") if isinstance(snapshot.get("gpu"), Mapping) else {}
    rows = gpu.get("gpus") if isinstance(gpu.get("gpus"), list) else []
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("GPU", style=THEME["white"])
    table.add_column("Util", justify="right", style=THEME["cyan"])
    table.add_column("Memory", justify="right", style=THEME["amber"])
    for row in rows:
        table.add_row(
            f"{row.get('index')} {row.get('name')}",
            f"{row.get('utilization_pct', 0)}%",
            f"{row.get('memory_used_mb', 0)} / {row.get('memory_total_mb', 0)} MB",
        )
    if not rows:
        table.add_row("-", "n/a", str(gpu.get("reason") or "no gpu data"))
    return frame(_provider_error_wrap(table, gpu), "GPU", subtitle=f"age={_provider_age(gpu)}")


def _plugins_panel(snapshot: Mapping[str, Any], *, plugin_renderables: Sequence[Any] = ()) -> Panel:
    providers = _providers(snapshot)
    plugins = providers.get("plugins") if isinstance(providers.get("plugins"), Mapping) else {}
    tools = providers.get("tools") if isinstance(providers.get("tools"), Mapping) else {}
    tui = snapshot.get("tui") if isinstance(snapshot.get("tui"), Mapping) else {}
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Kind", style=THEME["muted"])
    table.add_column("ID", style=THEME["white"])
    table.add_column("Capabilities / Message", style=THEME["cyan"])
    for plugin in plugins.get("plugins", []) if isinstance(plugins.get("plugins"), list) else []:
        caps = ", ".join(plugin.get("capabilities", []))
        trusted = " trusted" if plugin.get("trusted") else ""
        table.add_row("extension", str(plugin.get("id")), f"{caps}{trusted}")
    for tool in tools.get("tools", []) if isinstance(tools.get("tools"), list) else []:
        table.add_row("tool", str(tool.get("id")), ", ".join(tool.get("capabilities", [])))
    for notice in tui.get("python_plugin_notices", []) if isinstance(tui.get("python_plugin_notices"), list) else []:
        level = str(notice.get("level") or "info")
        table.add_row(level, str(notice.get("plugin_id") or "-"), str(notice.get("message") or notice))
    if table.row_count == 0:
        table.add_row("-", "none", "No enabled extensions.")
    body: Any = table
    if plugin_renderables:
        body = Group(table, *plugin_renderables)
    return frame(body, "Plugins / Tools / Errors", subtitle=f"python_panels={len(plugin_renderables)}")


def _help_panel() -> Panel:
    keys = Table.grid(expand=True)
    keys.add_column(ratio=1)
    keys.add_column(ratio=3)
    for key, action in [
        ("Tab / Shift+Tab", "switch tab"),
        ("1..5", "jump to tab"),
        ("Up / Down", "select row"),
        ("Enter", "open metric or run detail"),
        ("Esc", "return to overview / hide search / close help"),
        ("/", "focus search"),
        ("s", "toggle EMA emphasis"),
        ("d", "cycle decimal places"),
        ("r", "refresh providers asynchronously"),
        ("?", "toggle help"),
        ("q", "quit"),
    ]:
        keys.add_row(f"[bold {THEME['red_hot']}]{key}[/]", action)
    return frame(keys, "Help")


def _footer() -> Panel:
    return Panel(
        Align.left(" Tab switch  ↑↓ select  Enter detail  Esc back  / search  s EMA  d decimals  r refresh  ? help  q quit "),
        border_style=THEME["red"],
        box=box.SQUARE,
    )


def dashboard_renderable(snapshot: dict[str, Any]) -> Group:
    return Group(
        _status_bar(snapshot, "overview"),
        Columns([_authority_panel(snapshot), _gpu_panel(snapshot)], equal=True, expand=True),
        _loss_table_panel(snapshot),
        _runs_overview_panel(snapshot),
        _work_items_panel(snapshot),
        _plugins_panel(snapshot),
        _footer(),
    )


def tab_renderable(
    snapshot: dict[str, Any],
    tab_id: str,
    *,
    selected_metric_index: int = 0,
    selected_run_index: int = 0,
    selected_work_index: int = 0,
    detail: bool = False,
    run_detail: bool = False,
    show_smooth: bool = True,
    show_help: bool = False,
    decimal_places: int = 5,
    plugin_renderables: Sequence[Any] = (),
) -> Group:
    header = _status_bar(snapshot, tab_id)
    if show_help:
        return Group(header, _help_panel(), _footer())
    if tab_id == "loss":
        body: Any = _metric_detail_panel(snapshot, selected=selected_metric_index, places=decimal_places, show_smooth=show_smooth) if detail else _loss_table_panel(snapshot, selected=selected_metric_index, places=decimal_places)
        return Group(header, body, _gpu_panel(snapshot), _footer())
    if tab_id == "runs":
        body = _run_detail_panel(snapshot, selected=selected_run_index) if run_detail else _runs_overview_panel(snapshot, selected=selected_run_index)
        return Group(header, body, _footer())
    if tab_id == "authority":
        return Group(header, _authority_panel(snapshot), _work_items_panel(snapshot, selected=selected_work_index), _footer())
    if tab_id == "gpu":
        return Group(header, _gpu_panel(snapshot), _footer())
    if tab_id == "plugins":
        return Group(header, _plugins_panel(snapshot, plugin_renderables=plugin_renderables), _footer())
    return dashboard_renderable(snapshot)
