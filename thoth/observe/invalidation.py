"""Lightweight dashboard invalidation and delta helpers."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


WATCH_ROOTS = (
    ".thoth/objects",
    ".thoth/runs",
    ".thoth/extensions/manifest.json",
)


@dataclass(frozen=True)
class WatchedFile:
    relpath: str
    size: int
    mtime_ns: int


def _iter_watched_files(project_root: Path, *, max_files: int = 5000) -> list[WatchedFile]:
    rows: list[WatchedFile] = []
    for rel in WATCH_ROOTS:
        path = project_root / rel
        if path.is_file():
            candidates = [path]
        elif path.is_dir():
            candidates = [item for item in path.rglob("*") if item.is_file()]
        else:
            candidates = []
        for item in candidates:
            if len(rows) >= max_files:
                break
            try:
                stat = item.stat()
            except OSError:
                continue
            try:
                relpath = str(item.relative_to(project_root))
            except ValueError:
                relpath = str(item)
            rows.append(WatchedFile(relpath=relpath, size=stat.st_size, mtime_ns=stat.st_mtime_ns))
    rows.sort(key=lambda row: row.relpath)
    return rows


def _fingerprint(rows: list[WatchedFile]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        digest.update(f"{row.relpath}\0{row.size}\0{row.mtime_ns}\n".encode("utf-8", errors="replace"))
    return digest.hexdigest()[:16]


def _cursor(max_mtime_ns: int, fingerprint: str) -> str:
    return f"{max_mtime_ns}:{fingerprint}"


def parse_cursor(cursor: str | None) -> tuple[int, str] | None:
    if not cursor or ":" not in cursor:
        return None
    head, tail = cursor.split(":", 1)
    try:
        return int(head), tail
    except ValueError:
        return None


def invalidation_snapshot(project_root: Path) -> dict[str, Any]:
    rows = _iter_watched_files(project_root)
    max_mtime_ns = max((row.mtime_ns for row in rows), default=0)
    fingerprint = _fingerprint(rows)
    counts = {
        "objects": sum(1 for row in rows if row.relpath.startswith(".thoth/objects/")),
        "runs": sum(1 for row in rows if row.relpath.startswith(".thoth/runs/")),
        "extensions": sum(1 for row in rows if row.relpath.startswith(".thoth/extensions/")),
    }
    return {
        "schema_version": 1,
        "project_root": str(project_root.resolve()),
        "cursor": _cursor(max_mtime_ns, fingerprint),
        "max_mtime_ns": max_mtime_ns,
        "fingerprint": fingerprint,
        "file_count": len(rows),
        "counts": counts,
    }


def delta_since(project_root: Path, *, cursor: str | None = None, limit: int = 200) -> dict[str, Any]:
    parsed = parse_cursor(cursor)
    snapshot = invalidation_snapshot(project_root)
    previous_mtime = parsed[0] if parsed else -1
    previous_fingerprint = parsed[1] if parsed else ""
    rows = _iter_watched_files(project_root)
    changed = [row for row in rows if row.mtime_ns > previous_mtime]
    changed.sort(key=lambda row: row.mtime_ns, reverse=True)
    fingerprint_changed = bool(parsed and previous_fingerprint != snapshot["fingerprint"])
    return {
        "schema_version": 1,
        "project_root": snapshot["project_root"],
        "previous_cursor": cursor,
        "cursor": snapshot["cursor"],
        "changed": cursor is None or bool(changed) or fingerprint_changed,
        "fingerprint_changed": fingerprint_changed,
        "snapshot": snapshot,
        "events": [
            {
                "type": "file_changed",
                "path": row.relpath,
                "size": row.size,
                "mtime_ns": row.mtime_ns,
            }
            for row in changed[:limit]
        ],
    }


def sse_event(payload: dict[str, Any], *, event: str = "thoth.invalidate") -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
