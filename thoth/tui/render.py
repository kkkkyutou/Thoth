"""Rich renderables for the Thoth TUI."""

from __future__ import annotations

from typing import Any

from rich import box
from rich.columns import Columns
from rich.console import Group
from rich.panel import Panel
from rich.table import Table
from rich.text import Text


THEME = {
    "red": "#d21f3c",
    "white": "#f7f1e8",
    "muted": "#a99f99",
    "cyan": "#52f0ff",
    "amber": "#ffb454",
    "bg": "#080607",
}


def _provider_age(payload: dict[str, Any]) -> str:
    provider = payload.get("provider") if isinstance(payload.get("provider"), dict) else {}
    stale = provider.get("stale_seconds")
    if isinstance(stale, (int, float)):
        return f"{stale:.1f}s"
    return "unknown"


def _status_bar(snapshot: dict[str, Any]) -> Panel:
    project = snapshot.get("providers", {}).get("project", {}).get("project", {})
    name = project.get("name") or "Thoth"
    generated = snapshot.get("generated_at") or ""
    line = Text()
    line.append("THOTH TUI", style=f"bold {THEME['red']}")
    line.append("  ")
    line.append(str(name), style=THEME["white"])
    line.append("  ")
    line.append(str(generated), style=THEME["muted"])
    return Panel(line, box=box.SQUARE, border_style=THEME["red"], padding=(0, 1))


def _authority_panel(snapshot: dict[str, Any]) -> Panel:
    authority = snapshot.get("providers", {}).get("authority", {})
    summary = authority.get("summary") if isinstance(authority.get("summary"), dict) else {}
    table = Table.grid(expand=True)
    table.add_column(style=THEME["muted"])
    table.add_column(justify="right", style=THEME["white"])
    for key in ("work_item_counts", "decision_counts", "discussion_counts"):
        value = summary.get(key, {})
        table.add_row(key, str(value))
    problems = authority.get("problems") or []
    table.add_row("problems", str(len(problems)))
    table.add_row("age", _provider_age(authority))
    return Panel(table, title="Authority", border_style=THEME["red"], box=box.ROUNDED)


def _work_items_panel(snapshot: dict[str, Any]) -> Panel:
    work = snapshot.get("providers", {}).get("work_items", {})
    rows = work.get("work_items") if isinstance(work.get("work_items"), list) else []
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Work", style=THEME["white"], no_wrap=True)
    table.add_column("Status", style=THEME["cyan"])
    table.add_column("Module", style=THEME["muted"])
    table.add_column("Goal", style=THEME["white"])
    for item in rows[:8]:
        table.add_row(
            str(item.get("work_id") or item.get("id") or ""),
            str(item.get("authority_status") or item.get("ready_state") or item.get("status") or ""),
            str(item.get("module") or ""),
            str(item.get("goal_statement") or item.get("title") or "")[:72],
        )
    if not rows:
        table.add_row("-", "empty", "-", "No work items found.")
    return Panel(table, title=f"Work Items ({work.get('count', 0)})", border_style=THEME["red"], box=box.ROUNDED)


def _runs_panel(snapshot: dict[str, Any]) -> Panel:
    runs = snapshot.get("providers", {}).get("runs", {})
    rows = runs.get("runs") if isinstance(runs.get("runs"), list) else []
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Run", style=THEME["white"], no_wrap=True)
    table.add_column("Work", style=THEME["muted"])
    table.add_column("Phase", style=THEME["cyan"])
    table.add_column("Progress", justify="right", style=THEME["amber"])
    table.add_column("Message", style=THEME["white"])
    for run in rows[:8]:
        table.add_row(
            str(run.get("run_id") or ""),
            str(run.get("work_id") or ""),
            str(run.get("phase") or run.get("status") or ""),
            f"{float(run.get('progress_pct') or 0):.0f}%",
            str(run.get("latest_message") or "")[:64],
        )
    if not rows:
        table.add_row("-", "-", "idle", "0%", "No run ledger found.")
    return Panel(table, title=f"Runs ({runs.get('run_count', 0)})", border_style=THEME["red"], box=box.ROUNDED)


def _metrics_panel(snapshot: dict[str, Any]) -> Panel:
    metrics = snapshot.get("metrics", {})
    rows = metrics.get("metrics") if isinstance(metrics.get("metrics"), list) else []
    if not metrics.get("configured"):
        return Panel(
            Text(str(metrics.get("message") or "No metrics provider configured."), style=THEME["muted"]),
            title="Loss / Metrics",
            border_style=THEME["amber"],
            box=box.ROUNDED,
        )
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Metric", style=THEME["white"])
    table.add_column("Current", justify="right", style=THEME["cyan"])
    table.add_column("EMA", justify="right", style=THEME["red"])
    table.add_column("Trend", style=THEME["amber"])
    table.add_column("Spark", style=THEME["white"])
    for row in rows[:9]:
        table.add_row(
            str(row.get("name") or ""),
            f"{float(row.get('current') or 0):.5g}",
            f"{float(row.get('ema_current') or 0):.5g}",
            str(row.get("trend") or ""),
            str(row.get("sparkline") or ""),
        )
    return Panel(table, title=f"Loss / Metrics ({metrics.get('record_count', 0)} records)", border_style=THEME["red"], box=box.ROUNDED)


def _gpu_panel(snapshot: dict[str, Any]) -> Panel:
    gpu = snapshot.get("gpu", {})
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
    return Panel(table, title="GPU", border_style=THEME["red"], box=box.ROUNDED)


def _plugins_panel(snapshot: dict[str, Any]) -> Panel:
    plugins = snapshot.get("providers", {}).get("plugins", {})
    tools = snapshot.get("providers", {}).get("tools", {})
    table = Table(box=box.SIMPLE, expand=True)
    table.add_column("Kind", style=THEME["muted"])
    table.add_column("ID", style=THEME["white"])
    table.add_column("Capabilities", style=THEME["cyan"])
    for plugin in plugins.get("plugins", []) if isinstance(plugins.get("plugins"), list) else []:
        table.add_row("extension", str(plugin.get("id")), ", ".join(plugin.get("capabilities", [])))
    for tool in tools.get("tools", []) if isinstance(tools.get("tools"), list) else []:
        table.add_row("tool", str(tool.get("id")), ", ".join(tool.get("capabilities", [])))
    if table.row_count == 0:
        table.add_row("-", "none", "No enabled extensions.")
    return Panel(table, title="Plugins / Tools", border_style=THEME["red"], box=box.ROUNDED)


def dashboard_renderable(snapshot: dict[str, Any]) -> Group:
    return Group(
        _status_bar(snapshot),
        Columns([_authority_panel(snapshot), _gpu_panel(snapshot)], equal=True, expand=True),
        _metrics_panel(snapshot),
        _runs_panel(snapshot),
        _work_items_panel(snapshot),
        _plugins_panel(snapshot),
    )


def tab_renderable(snapshot: dict[str, Any], tab_id: str) -> Group:
    header = _status_bar(snapshot)
    if tab_id == "loss":
        return Group(header, _metrics_panel(snapshot))
    if tab_id == "runs":
        return Group(header, _runs_panel(snapshot))
    if tab_id == "authority":
        return Group(header, _authority_panel(snapshot), _work_items_panel(snapshot))
    if tab_id == "gpu":
        return Group(header, _gpu_panel(snapshot))
    if tab_id == "plugins":
        return Group(header, _plugins_panel(snapshot))
    return dashboard_renderable(snapshot)
