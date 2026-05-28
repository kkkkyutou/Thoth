"""Explicit metrics provider support for the Thoth TUI."""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


WINDOWS = (50, 150, 1000)


@dataclass(frozen=True)
class MetricRecord:
    step: int
    split: str
    metrics: dict[str, float]
    timestamp: str | None = None
    run_name: str | None = None


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
    chars = "._-~=+*#"
    if not values:
        return ""
    sample = list(values[-width:])
    lo = min(sample)
    hi = max(sample)
    if math.isclose(lo, hi):
        return chars[0] * len(sample)
    return "".join(chars[max(0, min(len(chars) - 1, int(round((value - lo) / (hi - lo) * (len(chars) - 1)))))] for value in sample)


def _groups(records: Iterable[MetricRecord]) -> dict[str, list[tuple[int, float]]]:
    grouped: dict[str, list[tuple[int, float]]] = {}
    for record in records:
        for key, value in record.metrics.items():
            grouped.setdefault(f"{record.split}.{key}", []).append((record.step, value))
    for values in grouped.values():
        values.sort(key=lambda item: item[0])
    return grouped


def summarize_metrics(records: Sequence[MetricRecord], *, run_name: str | None = None, ema_span: int = 50) -> dict[str, Any]:
    if not records:
        return {
            "schema_version": 1,
            "kind": "metrics",
            "configured": True,
            "record_count": 0,
            "latest_step": None,
            "metrics": [],
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
                "points": len(values),
                "history": {
                    "steps": steps[-200:],
                    "raw": values[-200:],
                    "ema": smooth[-200:],
                    "meta": {"raw_points": len(values), "latest_step": steps[-1]},
                },
            }
        )
    rows.sort(key=lambda row: (0 if "loss" in row["metric"].lower() else 1, row["split"], row["metric"]))
    return {
        "schema_version": 1,
        "kind": "metrics",
        "configured": True,
        "run_name": run_name or latest.run_name,
        "record_count": len(records),
        "latest_step": latest.step,
        "latest_timestamp": latest.timestamp,
        "metrics": rows,
    }

