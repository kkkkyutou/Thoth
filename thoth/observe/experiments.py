"""Experiment registry and channel providers for Thoth observe surfaces."""

from __future__ import annotations

import csv
import glob
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from thoth.objects import RevisionConflict, Store, utc_now
from thoth.observe.actions import record_action_receipt
from thoth.observe.extensions import enabled_extension_plugins
from thoth.run.io import _read_json
from thoth.tui.metrics import (
    DEFAULT_GLOBAL_MAX_POINTS,
    DEFAULT_LOCAL_WINDOW_STEPS,
    MetricRecord,
    parse_metric_line,
    read_metric_file,
    summarize_metrics,
)

EXPERIMENT_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")
EXPERIMENT_STATUSES = ("planned", "running", "paused", "completed", "failed", "archived")
EXPERIMENT_OBJECT_DIR = ".thoth/objects/experiment"
EXPERIMENT_CHANNELS = ("metrics", "logs", "artifacts", "events", "system", "gpu", "checkpoints", "alerts")
LOCAL_SELECTION_PATH = ".thoth/local/experiments/selection.json"
SOURCE_TYPES = ("jsonl", "csv", "tensorboard", "file", "glob", "object", "event")


class ExperimentError(ValueError):
    """Raised for invalid experiment registry operations."""


@dataclass(frozen=True)
class ExperimentFilters:
    search: str = ""
    status: str = ""
    tag: str = ""
    provider: str = ""
    limit: int = 100
    offset: int = 0


def _clean_string(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def validate_experiment_id(experiment_id: str) -> str:
    value = _clean_string(experiment_id)
    if not EXPERIMENT_ID_RE.match(value):
        raise ExperimentError("experiment id must match [a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}")
    return value


def _relative_path(value: Any, *, field: str) -> str:
    text = _clean_string(value)
    if not text:
        raise ExperimentError(f"{field} is required")
    path = Path(text)
    if path.is_absolute() or ".." in path.parts:
        raise ExperimentError(f"{field} must be a project-relative path and cannot contain '..'")
    return str(path)


def _normalize_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _normalize_refs(value: Mapping[str, Any] | None = None, **kwargs: Any) -> dict[str, str]:
    raw: dict[str, Any] = {}
    if isinstance(value, Mapping):
        raw.update(value)
    raw.update({key: val for key, val in kwargs.items() if val})
    refs = {}
    for key in ("work_id", "run_id", "controller_id"):
        val = _clean_string(raw.get(key))
        if val:
            refs[key] = val
    return refs


def _normalize_actor(value: Mapping[str, Any] | None = None, *, actor: str = "", source: str = "", surface: str = "") -> dict[str, str]:
    raw = value if isinstance(value, Mapping) else {}
    payload = {
        "actor": _clean_string(actor or raw.get("actor")),
        "source": _clean_string(source or raw.get("source") or "cli"),
        "surface": _clean_string(surface or raw.get("surface") or "cli"),
    }
    if not payload["actor"]:
        raise ExperimentError("actor is required")
    return payload


def normalize_source_descriptor(source: Mapping[str, Any], *, default_channel: str | None = None) -> dict[str, Any]:
    if not isinstance(source, Mapping):
        raise ExperimentError("source descriptor must be an object")
    channel = _clean_string(source.get("channel") or default_channel)
    if channel not in EXPERIMENT_CHANNELS:
        raise ExperimentError(f"source.channel must be one of {', '.join(EXPERIMENT_CHANNELS)}")
    source_id = _clean_string(source.get("id") or source.get("source_id") or channel)
    if not source_id:
        raise ExperimentError("source.id is required")
    source_type = _clean_string(source.get("type") or source.get("adapter") or ("jsonl" if channel == "metrics" else "file"))
    if source_type not in SOURCE_TYPES:
        raise ExperimentError(f"source.type must be one of {', '.join(SOURCE_TYPES)}")
    normalized: dict[str, Any] = {
        "id": source_id,
        "channel": channel,
        "type": source_type,
        "title": _clean_string(source.get("title") or source_id),
        "series": _clean_string(source.get("series") or source.get("series_id") or source_id),
    }
    if source.get("path") is not None:
        normalized["path"] = _relative_path(source.get("path"), field="source.path")
    if source.get("paths") is not None:
        paths = [_relative_path(item, field="source.paths[]") for item in _normalize_string_list(source.get("paths"))]
        normalized["paths"] = paths
    if source.get("glob") is not None:
        normalized["glob"] = _relative_path(source.get("glob"), field="source.glob")
    for key in ("split", "metric_prefix", "format", "description"):
        val = _clean_string(source.get(key))
        if val:
            normalized[key] = val
    if isinstance(source.get("config"), dict):
        normalized["config"] = dict(source["config"])
    return normalized


def _sources_by_channel(sources: Iterable[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    channels = {channel: [] for channel in EXPERIMENT_CHANNELS}
    for source in sources:
        normalized = normalize_source_descriptor(source)
        channels.setdefault(normalized["channel"], []).append(normalized)
    return {key: rows for key, rows in channels.items() if rows}


def normalize_experiment_payload(
    payload: Mapping[str, Any],
    *,
    actor: str = "",
    source: str = "",
    surface: str = "",
) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise ExperimentError("experiment spec must be an object")
    experiment_id = validate_experiment_id(_clean_string(payload.get("experiment_id") or payload.get("id")))
    status = _clean_string(payload.get("status") or "planned")
    if status not in EXPERIMENT_STATUSES:
        raise ExperimentError(f"status must be one of {', '.join(EXPERIMENT_STATUSES)}")
    title = _clean_string(payload.get("title") or experiment_id)
    description = _clean_string(payload.get("description") or payload.get("summary"))
    tags = _normalize_string_list(payload.get("tags"))
    actor_meta = _normalize_actor(payload.get("actor") if isinstance(payload.get("actor"), Mapping) else None, actor=actor, source=source, surface=surface)
    refs = _normalize_refs(payload.get("refs") if isinstance(payload.get("refs"), Mapping) else None, work_id=payload.get("work_id"), run_id=payload.get("run_id"), controller_id=payload.get("controller_id"))
    sources = payload.get("sources")
    if sources is None:
        sources = []
    if not isinstance(sources, list):
        raise ExperimentError("sources must be a list")
    normalized_sources = [normalize_source_descriptor(item) for item in sources]
    return {
        "experiment_id": experiment_id,
        "title": title,
        "description": description,
        "status": status,
        "tags": tags,
        "actor": actor_meta,
        "refs": refs,
        "sources": normalized_sources,
        "channels": _sources_by_channel(normalized_sources),
        "created_by": actor_meta,
    }


def experiment_store(project_root: Path) -> Store:
    return Store(project_root)


def experiment_path(project_root: Path, experiment_id: str) -> Path:
    return project_root / EXPERIMENT_OBJECT_DIR / f"{experiment_id}.json"


def _object_to_experiment(obj: Mapping[str, Any]) -> dict[str, Any]:
    payload = obj.get("payload") if isinstance(obj.get("payload"), Mapping) else {}
    rows = {
        "schema_version": 1,
        "kind": "experiment",
        "experiment_id": str(obj.get("object_id") or payload.get("experiment_id") or ""),
        "object_id": str(obj.get("object_id") or payload.get("experiment_id") or ""),
        "title": str(obj.get("title") or payload.get("title") or ""),
        "description": str(payload.get("description") or obj.get("summary") or ""),
        "status": str(obj.get("status") or payload.get("status") or "planned"),
        "revision": obj.get("revision"),
        "created_at": obj.get("created_at"),
        "updated_at": obj.get("updated_at"),
        "source": obj.get("source"),
        "tags": payload.get("tags") if isinstance(payload.get("tags"), list) else [],
        "actor": payload.get("actor") if isinstance(payload.get("actor"), Mapping) else {},
        "refs": payload.get("refs") if isinstance(payload.get("refs"), Mapping) else {},
        "sources": payload.get("sources") if isinstance(payload.get("sources"), list) else [],
        "channels": payload.get("channels") if isinstance(payload.get("channels"), Mapping) else {},
        "_path": obj.get("_path"),
    }
    rows["source_count"] = len(rows["sources"])
    rows["channel_count"] = len(rows["channels"])
    return rows


def read_experiment(project_root: Path, experiment_id: str) -> dict[str, Any]:
    eid = validate_experiment_id(experiment_id)
    obj = experiment_store(project_root).read("experiment", eid)
    if not obj:
        raise FileNotFoundError(f"experiment:{eid} not found")
    return _object_to_experiment(obj)


def list_registry_experiments(project_root: Path) -> list[dict[str, Any]]:
    rows = [_object_to_experiment(item) for item in experiment_store(project_root).list("experiment")]
    rows.sort(key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""), reverse=True)
    return rows


def _matches_filters(row: Mapping[str, Any], filters: ExperimentFilters) -> bool:
    if filters.status and str(row.get("status") or "") != filters.status:
        return False
    if filters.tag and filters.tag not in (row.get("tags") or []):
        return False
    if filters.provider:
        sources = row.get("sources") if isinstance(row.get("sources"), list) else []
        if not any(str(source.get("provider") or source.get("extension_id") or "") == filters.provider for source in sources if isinstance(source, Mapping)):
            return False
    if filters.search:
        needle = filters.search.lower()
        haystack = " ".join(str(row.get(key) or "") for key in ("experiment_id", "title", "description", "status")).lower()
        tags = " ".join(str(item) for item in row.get("tags", []))
        if needle not in f"{haystack} {tags}".lower():
            return False
    return True


def list_experiments(project_root: Path, filters: ExperimentFilters | None = None) -> dict[str, Any]:
    filters = filters or ExperimentFilters()
    rows = [row for row in list_registry_experiments(project_root) if _matches_filters(row, filters)]
    total = len(rows)
    limit = max(1, min(int(filters.limit), 1000))
    offset = max(0, int(filters.offset))
    return {
        "schema_version": 1,
        "kind": "experiments",
        "registry_path": EXPERIMENT_OBJECT_DIR,
        "total": total,
        "offset": offset,
        "limit": limit,
        "experiments": rows[offset : offset + limit],
        "selected_experiment_id": selected_experiment_id(project_root),
        "effective_experiment_id": default_experiment_id(project_root),
        "discovered": discover_experiments(project_root)["candidates"],
    }


def register_experiment(
    project_root: Path,
    spec: Mapping[str, Any],
    *,
    actor: str,
    source: str = "cli",
    surface: str = "cli",
    upsert: bool = False,
) -> dict[str, Any]:
    payload = normalize_experiment_payload(spec, actor=actor, source=source, surface=surface)
    store = experiment_store(project_root)
    eid = payload["experiment_id"]
    obj_payload = dict(payload)
    links: list[dict[str, str]] = []
    try:
        if upsert:
            obj = store.upsert(
                kind="experiment",
                object_id=eid,
                status=payload["status"],
                title=payload["title"],
                summary=payload["description"],
                source=source,
                links=links,
                payload=obj_payload,
                history_summary="experiment registered or updated",
            )
        else:
            obj = store.create(
                kind="experiment",
                object_id=eid,
                status=payload["status"],
                title=payload["title"],
                summary=payload["description"],
                source=source,
                links=links,
                payload=obj_payload,
            )
    except RevisionConflict as exc:
        raise ExperimentError(str(exc)) from exc
    receipt = record_action_receipt(
        project_root,
        action="extension.experiment.register",
        status="ok",
        summary=f"Experiment {eid} registered.",
        request={"experiment_id": eid, "upsert": upsert},
        result={"experiment": _object_to_experiment(obj)},
        artifacts=[str(experiment_path(project_root, eid).relative_to(project_root))],
        actor=actor,
    )
    return {"experiment": _object_to_experiment(obj), "receipt": receipt}


def update_experiment(project_root: Path, experiment_id: str, updates: Mapping[str, Any], *, actor: str, source: str = "cli") -> dict[str, Any]:
    eid = validate_experiment_id(experiment_id)
    current = read_experiment(project_root, eid)
    merged = {
        "experiment_id": eid,
        "title": updates.get("title", current["title"]),
        "description": updates.get("description", current.get("description", "")),
        "status": updates.get("status", current["status"]),
        "tags": updates.get("tags", current.get("tags", [])),
        "actor": current.get("actor", {"actor": actor, "source": source, "surface": "cli"}),
        "refs": {**(current.get("refs") or {}), **(updates.get("refs") if isinstance(updates.get("refs"), Mapping) else {})},
        "sources": current.get("sources", []),
    }
    for key in ("work_id", "run_id", "controller_id"):
        if updates.get(key):
            merged.setdefault("refs", {})[key] = updates[key]
    payload = normalize_experiment_payload(merged, actor=actor, source=source, surface="cli")
    obj = experiment_store(project_root).update(
        "experiment",
        eid,
        updates={"status": payload["status"], "title": payload["title"], "summary": payload["description"], "payload": payload},
        history_summary="experiment updated",
        source=source,
    )
    receipt = record_action_receipt(
        project_root,
        action="extension.experiment.update",
        status="ok",
        summary=f"Experiment {eid} updated.",
        request={"experiment_id": eid, "updates": dict(updates)},
        result={"experiment": _object_to_experiment(obj)},
        artifacts=[str(experiment_path(project_root, eid).relative_to(project_root))],
        actor=actor,
    )
    return {"experiment": _object_to_experiment(obj), "receipt": receipt}


def attach_source(project_root: Path, experiment_id: str, source_descriptor: Mapping[str, Any], *, actor: str, source: str = "cli") -> dict[str, Any]:
    eid = validate_experiment_id(experiment_id)
    current = read_experiment(project_root, eid)
    descriptor = normalize_source_descriptor(source_descriptor)
    sources = [item for item in current.get("sources", []) if isinstance(item, Mapping) and item.get("id") != descriptor["id"]]
    sources.append(descriptor)
    payload = normalize_experiment_payload({**current, "sources": sources}, actor=actor, source=source, surface="cli")
    obj = experiment_store(project_root).update(
        "experiment",
        eid,
        updates={"payload": payload},
        history_summary=f"experiment source attached: {descriptor['id']}",
        source=source,
    )
    receipt = record_action_receipt(
        project_root,
        action="extension.experiment.attach_source",
        status="ok",
        summary=f"Source {descriptor['id']} attached to experiment {eid}.",
        request={"experiment_id": eid, "source": descriptor},
        result={"experiment": _object_to_experiment(obj)},
        artifacts=[str(experiment_path(project_root, eid).relative_to(project_root))],
        actor=actor,
    )
    return {"experiment": _object_to_experiment(obj), "source": descriptor, "receipt": receipt}


def detach_source(project_root: Path, experiment_id: str, source_id: str, *, actor: str, source: str = "cli") -> dict[str, Any]:
    eid = validate_experiment_id(experiment_id)
    current = read_experiment(project_root, eid)
    keep = [item for item in current.get("sources", []) if isinstance(item, Mapping) and str(item.get("id")) != source_id]
    if len(keep) == len(current.get("sources", [])):
        raise ExperimentError(f"source not found: {source_id}")
    payload = normalize_experiment_payload({**current, "sources": keep}, actor=actor, source=source, surface="cli")
    obj = experiment_store(project_root).update(
        "experiment",
        eid,
        updates={"payload": payload},
        history_summary=f"experiment source detached: {source_id}",
        source=source,
    )
    receipt = record_action_receipt(
        project_root,
        action="extension.experiment.detach_source",
        status="ok",
        summary=f"Source {source_id} detached from experiment {eid}.",
        request={"experiment_id": eid, "source_id": source_id},
        result={"experiment": _object_to_experiment(obj)},
        artifacts=[str(experiment_path(project_root, eid).relative_to(project_root))],
        actor=actor,
    )
    return {"experiment": _object_to_experiment(obj), "receipt": receipt}


def selection_path(project_root: Path) -> Path:
    return project_root / LOCAL_SELECTION_PATH


def selected_experiment_id(project_root: Path) -> str | None:
    path = selection_path(project_root)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("experiment_id") if isinstance(payload, dict) else None
    return str(value) if value else None


def default_experiment_id(project_root: Path) -> str | None:
    """Return the effective experiment selection for read surfaces."""

    selected = selected_experiment_id(project_root)
    if selected:
        try:
            read_experiment(project_root, selected)
            return selected
        except (FileNotFoundError, ExperimentError):
            pass
    rows = list_registry_experiments(project_root)
    for status in ("running", "planned", "paused", "completed", "failed"):
        for row in rows:
            if row.get("status") == status:
                return str(row.get("experiment_id"))
    return str(rows[0].get("experiment_id")) if rows else None


def select_experiment(project_root: Path, experiment_id: str, *, series_id: str | None = None) -> dict[str, Any]:
    eid = validate_experiment_id(experiment_id)
    experiment = read_experiment(project_root, eid)
    payload = {"schema_version": 1, "experiment_id": eid, "series_id": series_id, "selected_at": utc_now()}
    path = selection_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"selected": payload, "experiment": experiment, "path": LOCAL_SELECTION_PATH}


def _path_for(project_root: Path, descriptor: Mapping[str, Any]) -> Path | None:
    path = descriptor.get("path")
    if not isinstance(path, str) or not path.strip():
        return None
    return project_root / path


def _paths_for(project_root: Path, descriptor: Mapping[str, Any]) -> list[Path]:
    rows: list[Path] = []
    path = _path_for(project_root, descriptor)
    if path is not None:
        rows.append(path)
    for item in descriptor.get("paths", []) if isinstance(descriptor.get("paths"), list) else []:
        if isinstance(item, str) and item.strip():
            rows.append(project_root / item)
    pattern = descriptor.get("glob")
    if isinstance(pattern, str) and pattern.strip():
        rows.extend(Path(item) for item in glob.glob(str(project_root / pattern), recursive=True))
    return rows


def _read_csv_metrics(path: Path, *, max_records: int) -> tuple[list[MetricRecord], int]:
    records: list[MetricRecord] = []
    bad = 0
    if not path.exists():
        return records, bad
    try:
        with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            rows = list(csv.DictReader(handle))
    except OSError:
        return records, bad
    for row in rows[-max_records:]:
        try:
            step = int(row.get("step") or row.get("global_step") or row.get("iteration") or 0)
        except (TypeError, ValueError):
            bad += 1
            continue
        split = str(row.get("split") or "train")
        metrics: dict[str, float] = {}
        for key, value in row.items():
            if key in {"step", "global_step", "iteration", "split", "timestamp", "run_name"}:
                continue
            try:
                number = float(value) if value not in (None, "") else math.nan
            except (TypeError, ValueError):
                continue
            if math.isfinite(number):
                metrics[key] = number
        if metrics:
            records.append(MetricRecord(step=step, split=split, metrics=metrics, timestamp=row.get("timestamp") or None, run_name=row.get("run_name") or None))
        else:
            bad += 1
    return records, bad


def _read_tensorboard_metrics(path: Path, *, max_records: int) -> tuple[list[MetricRecord], int, str | None]:
    try:
        from tensorboard.backend.event_processing.event_accumulator import EventAccumulator  # type: ignore
    except Exception as exc:
        return [], 0, f"tensorboard adapter unavailable: {type(exc).__name__}: {exc}"
    try:
        accumulator = EventAccumulator(str(path))
        accumulator.Reload()
        records: list[MetricRecord] = []
        for tag in accumulator.Tags().get("scalars", []):
            split = "train"
            metric_name = tag
            if "/" in tag:
                split, metric_name = tag.split("/", 1)
            for event in accumulator.Scalars(tag)[-max_records:]:
                records.append(MetricRecord(step=int(event.step), split=split, metrics={metric_name: float(event.value)}))
        return records[-max_records:], 0, None
    except Exception as exc:
        return [], 0, f"tensorboard read failed: {type(exc).__name__}: {exc}"


def metrics_for_experiment(
    project_root: Path,
    experiment_id: str | None = None,
    *,
    series_id: str | None = None,
    max_records: int = 200000,
    local_window_steps: int = DEFAULT_LOCAL_WINDOW_STEPS,
    global_max_points: int = DEFAULT_GLOBAL_MAX_POINTS,
    decimal_places: int = 5,
) -> dict[str, Any]:
    if experiment_id is None:
        experiment_id = default_experiment_id(project_root)
    if not experiment_id:
        return {
            "schema_version": 1,
            "kind": "metrics",
            "configured": False,
            "metrics": [],
            "message": "No experiment selected. Register and select an experiment to view metrics.",
            "experiment_id": None,
            "series": [],
        }
    experiment = read_experiment(project_root, experiment_id)
    source_rows = [
        source for source in experiment.get("sources", [])
        if isinstance(source, Mapping) and source.get("channel") == "metrics" and (not series_id or source.get("series") == series_id or source.get("id") == series_id)
    ]
    records: list[MetricRecord] = []
    bad_lines = 0
    provider_errors: list[str] = []
    source_files: list[str] = []
    series = []
    for source in source_rows:
        source_records: list[MetricRecord] = []
        source_bad = 0
        for path in _paths_for(project_root, source):
            source_files.append(str(path))
            if not path.exists():
                provider_errors.append(f"missing metrics file: {path}")
                continue
            if source.get("type") == "csv":
                next_records, next_bad = _read_csv_metrics(path, max_records=max_records)
            elif source.get("type") == "tensorboard":
                next_records, next_bad, error = _read_tensorboard_metrics(path, max_records=max_records)
                if error:
                    provider_errors.append(error)
            else:
                next_records, next_bad = read_metric_file(path, max_records=max_records)
            source_records.extend(next_records)
            source_bad += next_bad
        records.extend(source_records)
        bad_lines += source_bad
        series.append(
            {
                "id": source.get("id"),
                "series": source.get("series"),
                "title": source.get("title"),
                "type": source.get("type"),
                "record_count": len(source_records),
                "bad_lines": source_bad,
            }
        )
    payload = summarize_metrics(
        records,
        run_name=experiment.get("title") or experiment_id,
        decimal_places=decimal_places,
        local_window_steps=local_window_steps,
        global_max_points=global_max_points,
    )
    payload.update(
        {
            "configured": bool(source_rows),
            "experiment_id": experiment_id,
            "experiment": experiment,
            "series": series,
            "source_files": source_files,
            "bad_lines": bad_lines,
            "provider_errors": provider_errors,
            "message": "Metrics are projected from the selected experiment.",
        }
    )
    return payload


def _tail_text(path: Path, *, limit: int = 80) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
    except OSError:
        return []


def logs_for_experiment(project_root: Path, experiment: Mapping[str, Any], *, limit: int = 200) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for source in experiment.get("sources", []) if isinstance(experiment.get("sources"), list) else []:
        if not isinstance(source, Mapping) or source.get("channel") != "logs":
            continue
        for path in _paths_for(project_root, source):
            for idx, line in enumerate(_tail_text(path, limit=limit), start=1):
                rows.append({"source_id": source.get("id"), "path": str(path), "line": idx, "message": line})
    refs = experiment.get("refs") if isinstance(experiment.get("refs"), Mapping) else {}
    run_id = refs.get("run_id")
    if run_id:
        events_path = project_root / ".thoth" / "runs" / str(run_id) / "events.jsonl"
        for raw in _tail_text(events_path, limit=limit):
            record = parse_metric_line(raw)
            if record is None:
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    payload = {"message": raw}
                if isinstance(payload, dict):
                    rows.append({"source_id": "thoth-run-events", "path": str(events_path), **payload})
    return {"schema_version": 1, "kind": "logs", "experiment_id": experiment.get("experiment_id"), "logs": rows[-limit:], "log_count": min(len(rows), limit)}


def generic_channel_for_experiment(project_root: Path, experiment_id: str, channel: str) -> dict[str, Any]:
    experiment = read_experiment(project_root, experiment_id)
    if channel == "metrics":
        return metrics_for_experiment(project_root, experiment_id)
    if channel == "logs":
        return logs_for_experiment(project_root, experiment)
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for source in experiment.get("sources", []) if isinstance(experiment.get("sources"), list) else []:
        if not isinstance(source, Mapping) or source.get("channel") != channel:
            continue
        for path in _paths_for(project_root, source):
            item = {"source_id": source.get("id"), "path": str(path), "exists": path.exists()}
            if path.exists():
                try:
                    stat = path.stat()
                    item.update({"size": stat.st_size, "mtime": stat.st_mtime})
                    if channel in {"artifacts", "checkpoints"}:
                        item["title"] = source.get("title") or path.name
                        item["preview_type"] = _preview_type(path)
                    if channel in {"events", "alerts", "system", "gpu"} and path.is_file():
                        try:
                            item["payload"] = json.loads(path.read_text(encoding="utf-8"))
                        except (OSError, json.JSONDecodeError) as exc:
                            errors.append(f"{path}: {type(exc).__name__}: {exc}")
                except OSError as exc:
                    errors.append(f"{path}: {type(exc).__name__}: {exc}")
            rows.append(item)
    if channel == "alerts":
        rows.extend(_core_alerts(project_root, experiment))
    return {
        "schema_version": 1,
        "kind": channel,
        "experiment_id": experiment_id,
        channel: rows,
        "count": len(rows),
        "provider_errors": errors,
    }


def _preview_type(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    if ext in {"png", "jpg", "jpeg", "webp", "gif"}:
        return "image"
    if ext in {"csv", "tsv"}:
        return "table"
    if ext in {"json", "jsonl"}:
        return "json"
    if ext in {"md", "txt", "log"}:
        return "text"
    return "file"


def _core_alerts(project_root: Path, experiment: Mapping[str, Any]) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    try:
        metrics = metrics_for_experiment(project_root, str(experiment.get("experiment_id")))
    except Exception as exc:
        return [{"id": "metrics-provider-error", "level": "warning", "message": f"{type(exc).__name__}: {exc}", "source": "core"}]
    for error in metrics.get("provider_errors", []) if isinstance(metrics.get("provider_errors"), list) else []:
        alerts.append({"id": f"provider-{len(alerts)}", "level": "warning", "message": str(error), "source": "core"})
    for metric in metrics.get("metrics", []) if isinstance(metrics.get("metrics"), list) else []:
        current = metric.get("current")
        if isinstance(current, float) and (math.isnan(current) or math.isinf(current)):
            alerts.append({"id": f"nan-{metric.get('name')}", "level": "critical", "message": f"{metric.get('name')} is NaN/Inf", "source": "core"})
        spike = metric.get("recent_spike")
        if isinstance(spike, (int, float)) and spike > 0 and "loss" in str(metric.get("name", "")).lower():
            alerts.append({"id": f"loss-spike-{metric.get('name')}", "level": "warning", "message": f"Recent loss spike detected for {metric.get('name')}", "source": "core"})
    return alerts


def experiment_detail(project_root: Path, experiment_id: str) -> dict[str, Any]:
    experiment = read_experiment(project_root, experiment_id)
    channels = {}
    for channel in EXPERIMENT_CHANNELS:
        if channel in experiment.get("channels", {}) or channel == "alerts":
            try:
                channels[channel] = generic_channel_for_experiment(project_root, experiment_id, channel)
            except Exception as exc:
                channels[channel] = {"schema_version": 1, "kind": channel, "provider_errors": [f"{type(exc).__name__}: {exc}"]}
    return {"schema_version": 1, "experiment": experiment, "channels": channels}


def discover_experiments(project_root: Path) -> dict[str, Any]:
    registered = {row["experiment_id"] for row in list_registry_experiments(project_root)}
    candidates: list[dict[str, Any]] = []
    notices: list[dict[str, Any]] = []
    for plugin in enabled_extension_plugins(project_root):
        config = plugin.config
        rows = config.get("experiments")
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, Mapping):
                    continue
                try:
                    payload = normalize_experiment_payload(row, actor=f"extension:{plugin.plugin_id}", source=plugin.plugin_id, surface="extension")
                except ExperimentError as exc:
                    notices.append({"plugin_id": plugin.plugin_id, "level": "warning", "message": str(exc)})
                    continue
                payload["discovery_source"] = plugin.plugin_id
                payload["registered"] = payload["experiment_id"] in registered
                if not payload["registered"]:
                    candidates.append(payload)
        legacy_files = config.get("metrics_files")
        if legacy_files and plugin.has_metrics:
            files = legacy_files if isinstance(legacy_files, list) else [legacy_files]
            rel_files = []
            for item in files:
                try:
                    rel_files.append(_relative_path(item, field="metrics_files[]"))
                except ExperimentError as exc:
                    notices.append({"plugin_id": plugin.plugin_id, "level": "warning", "message": str(exc)})
            if rel_files:
                eid = validate_experiment_id(str(config.get("run_name") or plugin.plugin_id))
                if eid not in registered:
                    candidates.append(
                        {
                            "experiment_id": eid,
                            "title": str(config.get("run_name") or plugin.title or plugin.plugin_id),
                            "description": "Discovered from legacy metrics extension config.",
                            "status": "running",
                            "tags": ["legacy-metrics"],
                            "actor": {"actor": f"extension:{plugin.plugin_id}", "source": plugin.plugin_id, "surface": "extension"},
                            "refs": {},
                            "sources": [
                                {"id": f"{plugin.plugin_id}-metrics-{idx}", "channel": "metrics", "type": "jsonl", "path": path, "series": f"{plugin.plugin_id}-{idx}", "title": Path(path).name}
                                for idx, path in enumerate(rel_files)
                            ],
                            "channels": {},
                            "discovery_source": plugin.plugin_id,
                            "registered": False,
                        }
                    )
    return {"schema_version": 1, "kind": "experiment_discovery", "candidates": candidates, "notices": notices}


def validate_experiments(project_root: Path) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    seen: set[str] = set()
    for row in list_registry_experiments(project_root):
        eid = row.get("experiment_id")
        if not isinstance(eid, str) or not EXPERIMENT_ID_RE.match(eid):
            errors.append(f"invalid experiment id: {eid!r}")
            continue
        if eid in seen:
            errors.append(f"duplicate experiment id: {eid}")
        seen.add(eid)
        if row.get("status") not in EXPERIMENT_STATUSES:
            errors.append(f"{eid}: invalid status {row.get('status')!r}")
        actor = row.get("actor") if isinstance(row.get("actor"), Mapping) else {}
        for key in ("actor", "source", "surface"):
            if not actor.get(key):
                errors.append(f"{eid}: actor.{key} is required")
        for source in row.get("sources", []) if isinstance(row.get("sources"), list) else []:
            try:
                normalize_source_descriptor(source)
            except ExperimentError as exc:
                errors.append(f"{eid}: {exc}")
                continue
            for path in _paths_for(project_root, source):
                try:
                    path.relative_to(project_root)
                except ValueError:
                    errors.append(f"{eid}: source path escapes project root: {path}")
                if not path.exists():
                    warnings.append(f"{eid}: source path does not exist yet: {path.relative_to(project_root) if path.is_relative_to(project_root) else path}")
    discovery = discover_experiments(project_root)
    registered = set(seen)
    for candidate in discovery.get("candidates", []):
        eid = candidate.get("experiment_id")
        if eid in registered:
            warnings.append(f"provider candidate conflicts with registered experiment: {eid}")
    return {
        "schema_version": 1,
        "status": "ok" if not errors else "failed",
        "errors": errors,
        "warnings": warnings,
        "discovery": discovery,
        "experiment_count": len(seen),
    }


def experiment_provider(project_root: Path, filters: ExperimentFilters | None = None) -> dict[str, Any]:
    payload = list_experiments(project_root, filters)
    validation = validate_experiments(project_root)
    payload["validation_errors"] = validation["errors"]
    payload["validation_warnings"] = validation["warnings"]
    payload["status"] = "ok" if not validation["errors"] else "failed"
    return payload
