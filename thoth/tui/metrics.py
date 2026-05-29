"""Explicit metrics provider support for the Thoth TUI."""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


WINDOWS = (50, 150, 1000)
SPARK_CHARS = "▁▂▃▄▅▆▇█"
DEFAULT_LOCAL_WINDOW_STEPS = 1000
DEFAULT_GLOBAL_MAX_POINTS = 1200


@dataclass(frozen=True)
class MetricRecord:
    step: int
    split: str
    metrics: dict[str, float]
    timestamp: str | None = None
    run_name: str | None = None


@dataclass
class MetricFileState:
    """Incrementally tail one metric JSONL file without rereading it on every tick."""

    path: Path
    offset: int = 0
    inode: int | None = None
    records: list[MetricRecord] = field(default_factory=list)
    bad_lines: int = 0
    last_error: str | None = None
    partial_line: str = ""

    def tail(self, *, max_records: int = 200000) -> list[MetricRecord]:
        if not self.path.exists():
            self.last_error = f"metrics file not found: {self.path}"
            return self.records
        try:
            stat = self.path.stat()
            inode = stat.st_ino
            if self.inode is None or self.inode != inode or stat.st_size < self.offset:
                self.inode = inode
                self.offset = 0
                self.records.clear()
                self.bad_lines = 0
                self.partial_line = ""
            with self.path.open("rb") as handle:
                handle.seek(self.offset)
                chunk = handle.read()
                self.offset = handle.tell()
        except OSError as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return self.records
        text = self.partial_line + chunk.decode("utf-8", errors="replace")
        if text and not text.endswith(("\n", "\r")):
            lines = text.splitlines()
            self.partial_line = lines.pop() if lines else text
        else:
            lines = text.splitlines()
            self.partial_line = ""
        for raw in lines:
            if not raw.strip():
                continue
            record = parse_metric_line(raw)
            if record is None:
                self.bad_lines += 1
            else:
                self.records.append(record)
        if len(self.records) > max_records:
            self.records = self.records[-max_records:]
        self.last_error = None
        return self.records


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def parse_metric_line(line: str) -> MetricRecord | None:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, Mapping):
        return None
    try:
        step = int(payload.get("step", 0))
    except (TypeError, ValueError):
        return None
    split = str(payload.get("split") or "train")
    metrics: dict[str, float] = {}
    raw_metrics = payload.get("metrics")
    if isinstance(raw_metrics, Mapping):
        for key, value in raw_metrics.items():
            if _is_number(value):
                metrics[str(key)] = float(value)
    for key, value in payload.items():
        if key in {"timestamp", "run_name", "step", "split", "metrics"}:
            continue
        if _is_number(value):
            metrics[str(key)] = float(value)
    if not metrics:
        return None
    return MetricRecord(
        step=step,
        split=split,
        metrics=metrics,
        timestamp=payload.get("timestamp") if isinstance(payload.get("timestamp"), str) else None,
        run_name=payload.get("run_name") if isinstance(payload.get("run_name"), str) else None,
    )


def read_metric_file(path: str | Path, *, max_records: int = 200000) -> tuple[list[MetricRecord], int]:
    metric_path = Path(path)
    if not metric_path.exists():
        return [], 0
    records: list[MetricRecord] = []
    bad_lines = 0
    for raw in metric_path.read_text(encoding="utf-8", errors="replace").splitlines()[-max_records:]:
        if not raw.strip():
            continue
        record = parse_metric_line(raw)
        if record is None:
            bad_lines += 1
        else:
            records.append(record)
    return records, bad_lines


def mean(values: Sequence[float]) -> float | None:
    return None if not values else float(sum(values) / len(values))


def ema(values: Sequence[float], *, span: int = 50) -> list[float]:
    if not values:
        return []
    alpha = 2.0 / (float(span) + 1.0)
    out = [float(values[0])]
    for value in values[1:]:
        out.append(alpha * float(value) + (1.0 - alpha) * out[-1])
    return out


def trend(values: Sequence[float]) -> str:
    if len(values) < 2:
        return "flat"
    if values[-1] < values[-2]:
        return "down"
    if values[-1] > values[-2]:
        return "up"
    return "flat"


def sparkline(values: Sequence[float], *, width: int = 32) -> str:
    if not values:
        return ""
    sample = list(values[-width:])
    lo = min(sample)
    hi = max(sample)
    if math.isclose(lo, hi):
        return SPARK_CHARS[0] * len(sample)
    return "".join(
        SPARK_CHARS[
            max(0, min(len(SPARK_CHARS) - 1, int(round((value - lo) / (hi - lo) * (len(SPARK_CHARS) - 1)))))
        ]
        for value in sample
    )


def downsample_minmax(
    steps: Sequence[int],
    raw: Sequence[float],
    smooth: Sequence[float],
    *,
    max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
) -> dict[str, list[float] | list[int]]:
    """Downsample while preserving endpoints and visible raw-value spikes."""

    count = min(len(steps), len(raw), len(smooth))
    if count <= 0:
        return {"steps": [], "raw": [], "ema": []}
    if count <= max_points or max_points <= 0:
        return {"steps": list(steps[:count]), "raw": list(raw[:count]), "ema": list(smooth[:count])}
    if max_points < 4:
        indices = sorted({0, count - 1})
        return {
            "steps": [int(steps[index]) for index in indices],
            "raw": [float(raw[index]) for index in indices],
            "ema": [float(smooth[index]) for index in indices],
        }

    bucket_count = max(1, (max_points - 2) // 2)
    inner_count = count - 2
    indices = {0, count - 1}
    for bucket in range(bucket_count):
        start = 1 + int(bucket * inner_count / bucket_count)
        end = 1 + int((bucket + 1) * inner_count / bucket_count)
        if end <= start:
            end = min(count - 1, start + 1)
        if start >= count - 1:
            continue
        candidates = list(range(start, min(end, count - 1)))
        if not candidates:
            continue
        indices.add(min(candidates, key=lambda index: raw[index]))
        indices.add(max(candidates, key=lambda index: raw[index]))
    ordered = sorted(indices)
    if len(ordered) > max_points:
        stride = len(ordered) / float(max_points)
        selected = {ordered[0], ordered[-1]}
        for slot in range(1, max_points - 1):
            selected.add(ordered[int(round(slot * stride))])
        ordered = sorted(selected)
    return {
        "steps": [int(steps[index]) for index in ordered],
        "raw": [float(raw[index]) for index in ordered],
        "ema": [float(smooth[index]) for index in ordered],
    }


def metric_history(
    steps: Sequence[int],
    values: Sequence[float],
    smooth: Sequence[float],
    *,
    local_window_steps: int = DEFAULT_LOCAL_WINDOW_STEPS,
    global_max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
) -> dict[str, Any]:
    if not steps or not values:
        empty = {"steps": [], "raw": [], "ema": []}
        return {"steps": [], "raw": [], "ema": [], "local": empty, "global": empty, "meta": {}}
    latest_step = int(steps[-1])
    window_start = latest_step - max(1, int(local_window_steps)) + 1
    local_indices = [index for index, step in enumerate(steps) if int(step) >= window_start]
    if len(local_indices) < 2 and len(steps) >= 2:
        local_indices = [len(steps) - 2, len(steps) - 1]
    elif not local_indices:
        local_indices = [len(steps) - 1]
    local = {
        "steps": [int(steps[index]) for index in local_indices],
        "raw": [float(values[index]) for index in local_indices],
        "ema": [float(smooth[index]) for index in local_indices],
    }
    global_view = downsample_minmax(steps, values, smooth, max_points=global_max_points)
    return {
        "steps": local["steps"],
        "raw": local["raw"],
        "ema": local["ema"],
        "local": local,
        "global": global_view,
        "meta": {
            "first_step": int(steps[0]),
            "latest_step": latest_step,
            "raw_points": len(values),
            "local_points": len(local["steps"]),
            "global_points": len(global_view["steps"]),
            "local_window_steps": int(local_window_steps),
            "global_max_points": int(global_max_points),
        },
    }


def _groups(records: Iterable[MetricRecord]) -> dict[str, list[tuple[int, float]]]:
    grouped: dict[str, list[tuple[int, float]]] = {}
    for record in records:
        for key, value in record.metrics.items():
            grouped.setdefault(f"{record.split}.{key}", []).append((record.step, value))
    for values in grouped.values():
        values.sort(key=lambda item: item[0])
    return grouped


def summarize_metrics(
    records: Sequence[MetricRecord],
    *,
    run_name: str | None = None,
    ema_span: int = 50,
    decimal_places: int = 5,
    local_window_steps: int = DEFAULT_LOCAL_WINDOW_STEPS,
    global_max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
) -> dict[str, Any]:
    if not records:
        return {
            "schema_version": 1,
            "kind": "metrics",
            "configured": True,
            "record_count": 0,
            "latest_step": None,
            "progress": None,
            "decimal_places": decimal_places,
            "ema_span": ema_span,
            "metrics": [],
            "splits": {},
        }
    latest = max(records, key=lambda record: record.step)
    rows: list[dict[str, Any]] = []
    for name, step_values in _groups(records).items():
        steps = [step for step, _value in step_values]
        values = [value for _step, value in step_values]
        smooth = ema(values, span=ema_span)
        diffs = [abs(values[index] - values[index - 1]) for index in range(1, len(values))]
        rows.append(
            {
                "name": name,
                "split": name.split(".", 1)[0],
                "metric": name.split(".", 1)[1] if "." in name else name,
                "current_step": steps[-1],
                "current": values[-1],
                "ema_current": smooth[-1] if smooth else None,
                "mean_all": mean(values),
                **{f"mean_{window}": mean(values[-window:]) for window in WINDOWS},
                "min": min(values),
                "max": max(values),
                "recent_spike": max(diffs[-50:]) if diffs else 0.0,
                "stdev": statistics.fmean(diffs[-50:]) if diffs else 0.0,
                "trend": trend(values),
                "sparkline": sparkline(values),
                "ema_span": ema_span,
                "points": len(values),
                "history": metric_history(
                    steps,
                    values,
                    smooth,
                    local_window_steps=local_window_steps,
                    global_max_points=global_max_points,
                ),
            }
        )
    rows.sort(key=lambda row: (0 if "loss" in row["metric"].lower() else 1, row["split"], row["metric"]))
    split_counts: dict[str, int] = {}
    for record in records:
        split_counts[record.split] = split_counts.get(record.split, 0) + 1
    return {
        "schema_version": 1,
        "kind": "metrics",
        "configured": True,
        "run_name": run_name or latest.run_name,
        "record_count": len(records),
        "latest_step": latest.step,
        "latest_timestamp": latest.timestamp,
        "progress": None,
        "decimal_places": decimal_places,
        "ema_span": ema_span,
        "metrics": rows,
        "splits": split_counts,
    }


def selected_metric(summary: Mapping[str, Any], index: int) -> dict[str, Any] | None:
    metrics = summary.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        return None
    return metrics[index % len(metrics)]
