"""Braille chart renderer for TUI metric detail panels."""

from __future__ import annotations

import math
from dataclasses import dataclass
from hashlib import blake2b
from typing import Any, Iterable, Mapping, Sequence

from rich.console import Console, ConsoleOptions, RenderResult
from rich.text import Text


BRAILLE_BITS = {
    (0, 0): 0x01,
    (0, 1): 0x02,
    (0, 2): 0x04,
    (0, 3): 0x40,
    (1, 0): 0x08,
    (1, 1): 0x10,
    (1, 2): 0x20,
    (1, 3): 0x80,
}


@dataclass(frozen=True)
class ChartTheme:
    raw: str = "#b9aea5"
    raw_dim: str = "#756b64"
    smooth: str = "#ff4058"
    smooth_dim: str = "#8c2b37"
    grid: str = "#342222"
    axis: str = "#a51d2d"
    text: str = "#f4eee4"
    muted: str = "#9a8e86"


THEME = ChartTheme()
_CHART_CACHE: dict[str, Text] = {}
_CACHE_LIMIT = 96


def _as_floats(values: Any) -> list[float]:
    if not isinstance(values, list):
        return []
    out: list[float] = []
    for value in values:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
            out.append(float(value))
    return out


def _as_ints(values: Any) -> list[int]:
    if not isinstance(values, list):
        return []
    out: list[int] = []
    for value in values:
        try:
            out.append(int(value))
        except (TypeError, ValueError):
            continue
    return out


def _format_number(value: float, places: int) -> str:
    if not math.isfinite(value):
        return "-"
    if value != 0.0 and (abs(value) >= 10000 or abs(value) < 10 ** -(max(1, places - 1))):
        return f"{value:.2e}"
    return f"{value:.{places}f}"


def _line_points(points: Sequence[tuple[int, int]]) -> Iterable[tuple[int, int]]:
    if not points:
        return
    yield points[0]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        dx = x1 - x0
        dy = y1 - y0
        ticks = max(abs(dx), abs(dy), 1)
        for tick in range(1, ticks + 1):
            ratio = tick / float(ticks)
            yield (int(round(x0 + dx * ratio)), int(round(y0 + dy * ratio)))


def _scale_points(
    steps: Sequence[int],
    values: Sequence[float],
    *,
    x_min: int,
    x_max: int,
    y_min: float,
    y_max: float,
    pixel_width: int,
    pixel_height: int,
) -> list[tuple[int, int]]:
    if not steps or not values or pixel_width <= 0 or pixel_height <= 0:
        return []
    x_span = max(1, int(x_max) - int(x_min))
    y_span = y_max - y_min
    if math.isclose(y_span, 0.0):
        y_span = 1.0
    out: list[tuple[int, int]] = []
    for step, value in zip(steps, values):
        x = int(round((int(step) - int(x_min)) / float(x_span) * (pixel_width - 1)))
        y = int(round((y_max - float(value)) / float(y_span) * (pixel_height - 1)))
        out.append((max(0, min(pixel_width - 1, x)), max(0, min(pixel_height - 1, y))))
    return out


def _range_with_padding(values: Sequence[float]) -> tuple[float, float]:
    finite = [float(value) for value in values if math.isfinite(float(value))]
    if not finite:
        return 0.0, 1.0
    lo = min(finite)
    hi = max(finite)
    if math.isclose(lo, hi):
        pad = max(1.0e-6, abs(lo) * 0.08)
        return lo - pad, hi + pad
    pad = (hi - lo) * 0.08
    return lo - pad, hi + pad


def _cache_key(
    *,
    metric_name: str,
    scope: str,
    steps: Sequence[int],
    raw: Sequence[float],
    smooth: Sequence[float],
    width: int,
    height: int,
    show_smooth: bool,
    places: int,
) -> str:
    digest = blake2b(digest_size=12)
    for value in (metric_name, scope, str(width), str(height), str(show_smooth), str(places)):
        digest.update(value.encode("utf-8", errors="replace"))
        digest.update(b"\0")
    for series in (steps[:3], steps[-3:], raw[:3], raw[-3:], smooth[:3], smooth[-3:]):
        digest.update(repr(list(series)).encode("utf-8", errors="replace"))
        digest.update(b"\0")
    digest.update(str(len(steps)).encode("ascii"))
    return digest.hexdigest()


def _remember(key: str, value: Text) -> Text:
    if len(_CHART_CACHE) >= _CACHE_LIMIT:
        for old_key in list(_CHART_CACHE)[: _CACHE_LIMIT // 2]:
            _CHART_CACHE.pop(old_key, None)
    _CHART_CACHE[key] = value
    return value.copy()


def _cached(key: str) -> Text | None:
    value = _CHART_CACHE.get(key)
    return None if value is None else value.copy()


def render_connected_chart(
    *,
    metric_name: str,
    scope: str,
    steps: Sequence[int],
    raw: Sequence[float],
    smooth: Sequence[float],
    width: int,
    height: int,
    show_smooth: bool,
    places: int,
    theme: ChartTheme = THEME,
) -> Text:
    width = max(44, int(width))
    height = max(7, int(height))
    key = _cache_key(
        metric_name=metric_name,
        scope=scope,
        steps=steps,
        raw=raw,
        smooth=smooth,
        width=width,
        height=height,
        show_smooth=show_smooth,
        places=places,
    )
    cached = _cached(key)
    if cached is not None:
        return cached
    if not steps or not raw:
        return Text("no data", style=theme.muted)

    label_width = 12
    plot_width = max(24, width - label_width - 2)
    plot_height = height
    pixel_width = plot_width * 2
    pixel_height = plot_height * 4
    x_min = min(steps)
    x_max = max(steps)
    y_min, y_max = _range_with_padding(list(raw) + list(smooth))
    raw_points = _scale_points(
        steps,
        raw,
        x_min=x_min,
        x_max=x_max,
        y_min=y_min,
        y_max=y_max,
        pixel_width=pixel_width,
        pixel_height=pixel_height,
    )
    smooth_points = _scale_points(
        steps[-len(smooth) :] if smooth else [],
        smooth,
        x_min=x_min,
        x_max=x_max,
        y_min=y_min,
        y_max=y_max,
        pixel_width=pixel_width,
        pixel_height=pixel_height,
    )

    raw_masks = [[0 for _ in range(plot_width)] for _ in range(plot_height)]
    smooth_masks = [[0 for _ in range(plot_width)] for _ in range(plot_height)]

    def draw(points: Sequence[tuple[int, int]], masks: list[list[int]]) -> None:
        for x, y in _line_points(points):
            cell_x = max(0, min(plot_width - 1, x // 2))
            cell_y = max(0, min(plot_height - 1, y // 4))
            masks[cell_y][cell_x] |= BRAILLE_BITS[(x % 2, y % 4)]

    draw(raw_points, raw_masks)
    draw(smooth_points, smooth_masks)

    text = Text()
    grid_rows = {0, plot_height // 2, plot_height - 1}
    for row in range(plot_height):
        if row == 0:
            label_value = y_max
        elif row == plot_height // 2:
            label_value = (y_min + y_max) / 2.0
        elif row == plot_height - 1:
            label_value = y_min
        else:
            label_value = None
        label = "" if label_value is None else _format_number(label_value, places)
        text.append(f"{label:>{label_width - 1}} ", style=theme.muted)
        text.append("│", style=theme.axis)
        for col in range(plot_width):
            raw_mask = raw_masks[row][col]
            smooth_mask = smooth_masks[row][col]
            mask = raw_mask | smooth_mask
            if mask:
                style = f"bold {theme.smooth}" if smooth_mask else theme.raw
                if smooth_mask and not show_smooth:
                    style = theme.smooth_dim
                char = chr(0x2800 + mask)
            else:
                style = theme.grid if row in grid_rows else "#1b1111"
                char = "·" if row in grid_rows else " "
            text.append(char, style=style)
        text.append("\n")

    text.append(" " * (label_width - 1), style=theme.muted)
    text.append(" └", style=theme.axis)
    text.append("─" * plot_width, style=theme.axis)
    text.append("\n")
    left_step = str(x_min)
    right_step = str(x_max)
    middle = max(1, plot_width - len(left_step) - len(right_step))
    text.append(" " * label_width, style=theme.muted)
    text.append(left_step, style=theme.muted)
    text.append(" " * middle, style=theme.muted)
    text.append(right_step, style=theme.muted)
    text.append("\n")
    text.append(" " * label_width, style=theme.muted)
    text.append("raw", style=theme.raw)
    text.append(" + ", style=theme.muted)
    text.append("EMA", style=f"bold {theme.smooth}" if show_smooth else theme.smooth_dim)
    text.append(f"  {scope}  points={len(steps)}", style=theme.muted)
    return _remember(key, text)


class MetricChart:
    def __init__(
        self,
        metric: Mapping[str, Any],
        *,
        scope: str,
        height: int,
        show_smooth: bool,
        places: int,
    ) -> None:
        self.metric = metric
        self.scope = scope
        self.height = height
        self.show_smooth = show_smooth
        self.places = places

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        history = self.metric.get("history") if isinstance(self.metric.get("history"), Mapping) else {}
        view = history.get(self.scope) if isinstance(history.get(self.scope), Mapping) else {}
        steps = _as_ints(view.get("steps"))
        raw = _as_floats(view.get("raw"))
        smooth = _as_floats(view.get("ema"))
        count = min(len(steps), len(raw))
        steps = steps[:count]
        raw = raw[:count]
        smooth = smooth[:count]
        yield render_connected_chart(
            metric_name=str(self.metric.get("name") or "metric"),
            scope=self.scope,
            steps=steps,
            raw=raw,
            smooth=smooth,
            width=max(44, options.max_width - 2),
            height=self.height,
            show_smooth=self.show_smooth,
            places=self.places,
        )
