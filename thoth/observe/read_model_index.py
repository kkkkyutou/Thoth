"""Lightweight derived read-model index with optional DuckDB mirror."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from thoth.observe.extensions import extension_summary
from thoth.observe.read_model import load_tasks
from thoth.run.io import _read_json


INDEX_DIR = ".thoth/derived/read-model"
SQLITE_NAME = "index.sqlite3"
DUCKDB_NAME = "index.duckdb"


def index_dir(project_root: Path) -> Path:
    return project_root / INDEX_DIR


def _run_rows(project_root: Path) -> list[dict[str, Any]]:
    runs_dir = project_root / ".thoth" / "runs"
    if not runs_dir.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        run = _read_json(run_dir / "run.json")
        state = _read_json(run_dir / "state.json")
        result = _read_json(run_dir / "result.json")
        rows.append(
            {
                "run_id": str(run.get("run_id") or state.get("run_id") or run_dir.name),
                "work_id": run.get("work_id") or state.get("work_id"),
                "status": state.get("status") or result.get("status") or run.get("status"),
                "phase": state.get("phase") or run.get("phase"),
                "updated_at": state.get("updated_at") or result.get("updated_at") or run.get("updated_at") or run.get("created_at"),
            }
        )
    return rows


def _connect_sqlite(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _write_sqlite(project_root: Path, sqlite_path: Path) -> dict[str, int]:
    work_items = load_tasks(project_root)
    runs = _run_rows(project_root)
    plugins = extension_summary(project_root).get("plugins", [])
    with _connect_sqlite(sqlite_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS work_items (
                work_id TEXT PRIMARY KEY,
                title TEXT,
                status TEXT,
                module TEXT,
                direction TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                work_id TEXT,
                status TEXT,
                phase TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS plugins (
                plugin_id TEXT PRIMARY KEY,
                title TEXT,
                version TEXT,
                enabled INTEGER,
                capabilities_json TEXT
            );
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            DELETE FROM work_items;
            DELETE FROM runs;
            DELETE FROM plugins;
            """
        )
        conn.executemany(
            "INSERT OR REPLACE INTO work_items (work_id, title, status, module, direction, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    str(item.get("work_id") or item.get("id") or ""),
                    str(item.get("title") or ""),
                    str(item.get("authority_status") or item.get("ready_state") or item.get("status") or ""),
                    str(item.get("module") or ""),
                    str(item.get("direction") or ""),
                    str(item.get("updated_at") or item.get("created_at") or ""),
                )
                for item in work_items
                if item.get("work_id") or item.get("id")
            ],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO runs (run_id, work_id, status, phase, updated_at) VALUES (?, ?, ?, ?, ?)",
            [
                (
                    str(item.get("run_id") or ""),
                    str(item.get("work_id") or ""),
                    str(item.get("status") or ""),
                    str(item.get("phase") or ""),
                    str(item.get("updated_at") or ""),
                )
                for item in runs
                if item.get("run_id")
            ],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO plugins (plugin_id, title, version, enabled, capabilities_json) VALUES (?, ?, ?, ?, ?)",
            [
                (
                    str(item.get("id") or ""),
                    str(item.get("title") or ""),
                    str(item.get("version") or ""),
                    1 if item.get("enabled") else 0,
                    json.dumps(item.get("capabilities") or [], ensure_ascii=False),
                )
                for item in plugins
                if item.get("id")
            ],
        )
        conn.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", ("schema_version", "1"))
    return {"work_items": len(work_items), "runs": len(runs), "plugins": len(plugins)}


def _write_duckdb(sqlite_path: Path, duckdb_path: Path) -> dict[str, Any]:
    try:
        import duckdb  # type: ignore
    except Exception as exc:
        return {"available": False, "reason": f"{type(exc).__name__}: {exc}"}
    try:
        conn = duckdb.connect(str(duckdb_path))
        try:
            conn.execute("INSTALL sqlite")
        except Exception:
            pass
        try:
            conn.execute("LOAD sqlite")
            conn.execute("CREATE OR REPLACE TABLE work_items AS SELECT * FROM sqlite_scan(?, 'work_items')", [str(sqlite_path)])
            conn.execute("CREATE OR REPLACE TABLE runs AS SELECT * FROM sqlite_scan(?, 'runs')", [str(sqlite_path)])
            conn.execute("CREATE OR REPLACE TABLE plugins AS SELECT * FROM sqlite_scan(?, 'plugins')", [str(sqlite_path)])
        finally:
            conn.close()
        return {"available": True, "path": str(duckdb_path)}
    except Exception as exc:
        return {"available": False, "reason": f"{type(exc).__name__}: {exc}"}


def build_read_model_index(project_root: Path) -> dict[str, Any]:
    root = index_dir(project_root)
    root.mkdir(parents=True, exist_ok=True)
    sqlite_path = root / SQLITE_NAME
    counts = _write_sqlite(project_root, sqlite_path)
    duckdb_path = root / DUCKDB_NAME
    duckdb = _write_duckdb(sqlite_path, duckdb_path)
    return {
        "schema_version": 1,
        "project_root": str(project_root.resolve()),
        "sqlite": {"path": str(sqlite_path.relative_to(project_root)), "available": True},
        "duckdb": duckdb,
        "counts": counts,
    }
