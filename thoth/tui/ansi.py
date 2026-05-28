"""ANSI helpers for agent-safe TUI snapshots."""

from __future__ import annotations

import re


ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def has_ansi(value: str) -> bool:
    return bool(ANSI_RE.search(value))


def strip_ansi(value: str) -> str:
    return ANSI_RE.sub("", value)

