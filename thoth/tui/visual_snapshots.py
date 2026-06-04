"""Mechanical visual snapshots for the Thoth TUI."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from .snapshot import build_snapshot


BG = "#070506"
PANEL = "#15090b"
PANEL_ALT = "#1b0d10"
RED = "#d21f3c"
RED_2 = "#ff4d66"
WHITE = "#f7f1e8"
MUTED = "#a99f99"
CYAN = "#52f0ff"
AMBER = "#ffb454"
BORDER = "#5a1a25"


def _font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def _text_width(text: str, size: int, *, bold: bool = False) -> int:
    font = _font(size, bold=bold)
    box = font.getbbox(text)
    return max(0, box[2] - box[0])


def _fit(text: Any, width: int, size: int, *, bold: bool = False) -> str:
    value = str(text)
    if _text_width(value, size, bold=bold) <= width:
        return value
    suffix = "..."
    limit = max(1, width - _text_width(suffix, size, bold=bold))
    acc = ""
    for char in value:
        if _text_width(acc + char, size, bold=bold) > limit:
            break
        acc += char
    return acc.rstrip() + suffix


def _text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: Any,
    *,
    fill: str = WHITE,
    size: int = 15,
    bold: bool = False,
    max_width: int | None = None,
) -> None:
    value = _fit(text, max_width, size, bold=bold) if max_width else str(text)
    draw.text(xy, value, fill=fill, font=_font(size, bold=bold))


def _card(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, subtitle: str = "") -> None:
    draw.rounded_rectangle(box, radius=8, fill=PANEL, outline=BORDER, width=1)
    draw.line((box[0] + 1, box[1] + 1, box[2] - 1, box[1] + 1), fill=RED, width=1)
    _text(draw, (box[0] + 16, box[1] + 12), title.upper(), fill=MUTED, size=13, bold=True, max_width=box[2] - box[0] - 32)
    if subtitle:
        _text(draw, (box[2] - 180, box[1] + 12), subtitle, fill=CYAN, size=12, bold=True, max_width=164)


def _progress_bar(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], pct: float, *, fill: str = RED) -> None:
    pct = max(0.0, min(100.0, float(pct)))
    draw.rounded_rectangle(box, radius=5, fill="#2a171a")
    if pct > 0:
        x2 = box[0] + int((box[2] - box[0]) * pct / 100)
        draw.rounded_rectangle((box[0], box[1], x2, box[3]), radius=5, fill=fill)


def _metric_chart(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], row: dict[str, Any]) -> None:
    values = ((row.get("history") or {}).get("raw") if isinstance(row.get("history"), dict) else None) or []
    values = [float(v) for v in values if isinstance(v, (int, float))]
    draw.rounded_rectangle(box, radius=8, fill=PANEL_ALT)
    _text(draw, (box[0] + 10, box[1] + 8), row.get("name", "metric"), fill=MUTED, size=12, max_width=box[2] - box[0] - 20)
    _text(draw, (box[2] - 80, box[1] + 8), f"{float(row.get('current') or 0):.4g}", fill=CYAN, size=12, bold=True, max_width=70)
    if len(values) < 2:
        return
    left, top, right, bottom = box[0] + 10, box[1] + 36, box[2] - 10, box[3] - 12
    lo, hi = min(values), max(values)
    span = hi - lo or 1.0
    points: list[tuple[int, int]] = []
    for index, value in enumerate(values):
        x = left + int((right - left) * index / max(1, len(values) - 1))
        y = bottom - int((bottom - top) * (value - lo) / span)
        points.append((x, y))
    glow = [(x, y + 3) for x, y in points]
    if len(glow) > 1:
        draw.line(glow, fill="#71323a", width=5, joint="curve")
        draw.line(points, fill=CYAN, width=3, joint="curve")


def _snapshot_header(draw: ImageDraw.ImageDraw, snapshot: dict[str, Any], width: int) -> int:
    draw.rectangle((0, 0, width, 8), fill=RED)
    project = ((snapshot.get("providers") or {}).get("project") or {}).get("project") or {}
    _text(draw, (28, 28), "THOTH TUI", fill=RED_2, size=30, bold=True)
    _text(draw, (220, 36), project.get("name") or "Thoth Project", fill=WHITE, size=18, bold=True, max_width=width - 560)
    _text(draw, (28, 72), snapshot.get("generated_at") or "", fill=MUTED, size=13)
    providers = snapshot.get("providers") or {}
    plugins = (providers.get("plugins") or {}).get("enabled_plugin_count", 0)
    runs = (providers.get("runs") or {}).get("run_count", 0)
    records = (providers.get("metrics") or {}).get("record_count", 0)
    if width < 900:
        _text(draw, (width - 168, 72), f"runs {runs} / plugins {plugins} / records {records}", fill=MUTED, size=11, max_width=146)
        return 108
    pills = [("runs", runs), ("plugins", plugins), ("records", records)]
    x = max(680, width - 460)
    for label, value in pills:
        draw.rounded_rectangle((x, 28, x + 132, 64), radius=8, fill="#1a0d10", outline="#4b2028")
        _text(draw, (x + 14, 38), f"{label} {value}", fill=WHITE, size=13, bold=True, max_width=104)
        x += 144
    return 108


def _summary_cards(draw: ImageDraw.ImageDraw, snapshot: dict[str, Any], x: int, y: int, width: int) -> int:
    providers = snapshot.get("providers") or {}
    work = providers.get("work_items") or {}
    runs = providers.get("runs") or {}
    counts = work.get("status_counts") if isinstance(work.get("status_counts"), dict) else {}
    cells = [
        ("work", work.get("count", 0), RED),
        ("validated", counts.get("validated", 0), CYAN),
        ("active", counts.get("active", 0), AMBER),
        ("blocked", counts.get("blocked", 0), RED_2),
        ("runs", runs.get("run_count", 0), WHITE),
    ]
    gap = 12
    cell_w = (width - gap * (len(cells) - 1)) // len(cells)
    for idx, (label, value, color) in enumerate(cells):
        left = x + idx * (cell_w + gap)
        draw.rounded_rectangle((left, y, left + cell_w, y + 82), radius=8, fill=PANEL, outline=BORDER)
        _text(draw, (left + 14, y + 14), label.upper(), fill=MUTED, size=12, bold=True, max_width=cell_w - 28)
        _text(draw, (left + 14, y + 40), value, fill=color, size=24, bold=True, max_width=cell_w - 28)
    return y + 100


def _draw_wide(snapshot: dict[str, Any], path: Path, *, width: int, height: int) -> None:
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    y = _snapshot_header(draw, snapshot, width)
    margin = 26
    content_w = width - margin * 2
    y = _summary_cards(draw, snapshot, margin, y, content_w)
    gap = 16
    left_w = int(content_w * 0.58)
    right_w = content_w - left_w - gap
    metrics_box = (margin, y, margin + left_w, y + 330)
    _card(draw, metrics_box, "Loss / Metrics", f"{(snapshot.get('metrics') or {}).get('record_count', 0)} records")
    metrics = (snapshot.get("metrics") or {}).get("metrics") or []
    chart_w = (left_w - 52) // 2
    chart_h = 118
    for index, row in enumerate(metrics[:4]):
        cx = metrics_box[0] + 16 + (index % 2) * (chart_w + 20)
        cy = metrics_box[1] + 50 + (index // 2) * (chart_h + 16)
        _metric_chart(draw, (cx, cy, cx + chart_w, cy + chart_h), row)
    if not (snapshot.get("metrics") or {}).get("configured"):
        _text(draw, (metrics_box[0] + 18, metrics_box[1] + 56), (snapshot.get("metrics") or {}).get("message", "No metrics provider configured."), fill=AMBER, size=15, max_width=left_w - 36)

    runs_box = (margin + left_w + gap, y, margin + content_w, y + 330)
    _card(draw, runs_box, "Runs / GPU", "split refresh")
    runs = ((snapshot.get("providers") or {}).get("runs") or {}).get("runs") or []
    yy = runs_box[1] + 50
    for run in runs[:3]:
        _text(draw, (runs_box[0] + 16, yy), run.get("run_id", "run"), fill=WHITE, size=13, bold=True, max_width=right_w - 118)
        _text(draw, (runs_box[2] - 96, yy), run.get("phase") or run.get("status", ""), fill=MUTED, size=12, max_width=78)
        yy += 24
        pct = float(run.get("progress_pct") or 0)
        _progress_bar(draw, (runs_box[0] + 16, yy, runs_box[2] - 54, yy + 10), pct, fill=RED)
        _text(draw, (runs_box[2] - 46, yy - 4), f"{pct:.0f}%", fill=CYAN, size=12, bold=True, max_width=42)
        yy += 30
    gpu = snapshot.get("gpu") or {}
    gpus = gpu.get("gpus") if isinstance(gpu.get("gpus"), list) else []
    yy += 6
    _text(draw, (runs_box[0] + 16, yy), "GPU", fill=RED_2, size=14, bold=True)
    yy += 26
    if not gpus:
        _text(draw, (runs_box[0] + 16, yy), gpu.get("reason") or "GPU unavailable", fill=MUTED, size=13, max_width=right_w - 36)
    for row in gpus[:3]:
        _text(draw, (runs_box[0] + 16, yy), row.get("name", "gpu"), fill=MUTED, size=12, max_width=142)
        pct = float(row.get("utilization_pct") or 0)
        _progress_bar(draw, (runs_box[0] + 166, yy + 5, runs_box[2] - 54, yy + 15), pct, fill=CYAN)
        _text(draw, (runs_box[2] - 46, yy), f"{pct:.0f}%", fill=WHITE, size=12, bold=True, max_width=42)
        yy += 28

    y += 348
    work_box = (margin, y, margin + left_w, y + 280)
    _card(draw, work_box, "Authority / Work Items", "object graph")
    work_items = ((snapshot.get("providers") or {}).get("work_items") or {}).get("work_items") or []
    yy = work_box[1] + 52
    for item in work_items[:6]:
        status = str(item.get("authority_status") or item.get("status") or "")
        color = CYAN if status == "validated" else AMBER if status == "active" else RED_2 if status in {"blocked", "failed"} else WHITE
        _text(draw, (work_box[0] + 16, yy), item.get("work_id", "work"), fill=WHITE, size=12, bold=True, max_width=170)
        _text(draw, (work_box[0] + 198, yy), status, fill=color, size=12, bold=True, max_width=84)
        _text(draw, (work_box[0] + 298, yy), item.get("goal_statement") or item.get("title", ""), fill=MUTED, size=12, max_width=left_w - 316)
        yy += 32

    plugin_box = (margin + left_w + gap, y, margin + content_w, y + 280)
    _card(draw, plugin_box, "Plugins / Tool Isolation", "manifest")
    plugins = ((snapshot.get("providers") or {}).get("plugins") or {}).get("plugins") or []
    tools = ((snapshot.get("providers") or {}).get("tools") or {}).get("tools") or []
    yy = plugin_box[1] + 52
    for plugin in plugins[:4]:
        _text(draw, (plugin_box[0] + 16, yy), plugin.get("id", "plugin"), fill=WHITE, size=12, bold=True, max_width=180)
        _text(draw, (plugin_box[0] + 206, yy), ", ".join(plugin.get("capabilities", [])), fill=CYAN, size=11, max_width=right_w - 220)
        yy += 28
    yy += 10
    for tool in tools[:3]:
        _text(draw, (plugin_box[0] + 16, yy), tool.get("title") or tool.get("id", "tool"), fill=AMBER, size=12, bold=True, max_width=180)
        _text(draw, (plugin_box[0] + 206, yy), ", ".join(tool.get("capabilities", [])), fill=MUTED, size=11, max_width=right_w - 220)
        yy += 28

    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def _draw_narrow(snapshot: dict[str, Any], path: Path, *, width: int, height: int) -> None:
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    y = _snapshot_header(draw, snapshot, width)
    margin = 18
    content_w = width - margin * 2
    y = _summary_cards(draw, snapshot, margin, y, content_w)
    sections = [
        ("Loss / Metrics", "records"),
        ("Runs", "ledgers"),
        ("Authority / Work", "portable"),
        ("GPU / Plugins", "providers"),
    ]
    for title, subtitle in sections:
        box = (margin, y, width - margin, y + 190)
        _card(draw, box, title, subtitle)
        if title.startswith("Loss"):
            metrics = (snapshot.get("metrics") or {}).get("metrics") or []
            yy = y + 48
            for row in metrics[:4]:
                _text(draw, (margin + 16, yy), row.get("name", "metric"), fill=WHITE, size=12, max_width=150)
                _progress_bar(draw, (margin + 176, yy + 5, width - margin - 54, yy + 15), 100 - min(100, float(row.get("current") or 0) * 16), fill=CYAN)
                _text(draw, (width - margin - 46, yy), f"{float(row.get('current') or 0):.3g}", fill=CYAN, size=11, max_width=42)
                yy += 30
        elif title == "Runs":
            runs = ((snapshot.get("providers") or {}).get("runs") or {}).get("runs") or []
            yy = y + 48
            for run in runs[:4]:
                _text(draw, (margin + 16, yy), run.get("run_id", "run"), fill=WHITE, size=12, bold=True, max_width=190)
                _text(draw, (width - margin - 96, yy), run.get("phase") or run.get("status", ""), fill=MUTED, size=11, max_width=82)
                yy += 30
        elif title.startswith("Authority"):
            work_items = ((snapshot.get("providers") or {}).get("work_items") or {}).get("work_items") or []
            yy = y + 48
            for item in work_items[:5]:
                _text(draw, (margin + 16, yy), item.get("work_id", "work"), fill=WHITE, size=11, max_width=150)
                _text(draw, (margin + 176, yy), item.get("authority_status") or item.get("status", ""), fill=RED_2, size=11, max_width=80)
                yy += 26
        else:
            gpu = snapshot.get("gpu") or {}
            gpus = gpu.get("gpus") if isinstance(gpu.get("gpus"), list) else []
            yy = y + 48
            for row in gpus[:2]:
                _text(draw, (margin + 16, yy), row.get("name", "gpu"), fill=MUTED, size=11, max_width=166)
                _progress_bar(draw, (margin + 190, yy + 5, width - margin - 54, yy + 15), float(row.get("utilization_pct") or 0), fill=CYAN)
                yy += 28
            tools = ((snapshot.get("providers") or {}).get("tools") or {}).get("tools") or []
            for tool in tools[:2]:
                _text(draw, (margin + 16, yy), tool.get("title") or tool.get("id", "tool"), fill=AMBER, size=11, bold=True, max_width=content_w - 32)
                yy += 24
        y += 208
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def render_snapshot_image(snapshot: dict[str, Any], path: Path, *, width: int, height: int) -> None:
    if width < 900:
        _draw_narrow(snapshot, path, width=width, height=height)
    else:
        _draw_wide(snapshot, path, width=width, height=height)


def export_visual_snapshots(snapshot_dir: str | Path, *, project_root: str | Path = ".", no_gpu: bool = True) -> dict[str, Any]:
    root = Path(project_root).resolve()
    output = Path(snapshot_dir)
    snapshot = build_snapshot(project_root=root, no_gpu=no_gpu)
    empty_metrics = copy.deepcopy(snapshot)
    empty_metrics["metrics"] = {
        "schema_version": 1,
        "kind": "metrics",
        "configured": False,
        "metrics": [],
        "message": "No metrics provider configured. Add a metrics-capable plugin in .thoth/extensions/manifest.json.",
    }
    empty_metrics.setdefault("providers", {})["metrics"] = empty_metrics["metrics"]
    plugin_error = copy.deepcopy(snapshot)
    plugin_error.setdefault("providers", {}).setdefault("plugins", {})["validation_errors"] = ["duplicate extension id: demo"]
    specs = [
        ("tui-wide", snapshot, 1440, 980),
        ("tui-narrow", snapshot, 760, 1180),
        ("tui-empty-metrics", empty_metrics, 1440, 980),
        ("tui-plugin-error", plugin_error, 1440, 980),
    ]
    rows: list[dict[str, str]] = []
    for shot_id, payload, width, height in specs:
        path = output / f"{shot_id}.png"
        render_snapshot_image(payload, path, width=width, height=height)
        rows.append({"id": shot_id, "path": str(path)})
    manifest = {
        "schema_version": 1,
        "project_root": str(root),
        "snapshots": rows,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest
