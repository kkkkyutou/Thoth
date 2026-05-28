"""Repo-local Thoth state layout and Git ignore helpers."""

from __future__ import annotations

from pathlib import Path

PORTABLE_AUTHORITY_PATHS = (
    "AGENTS.md",
    "CLAUDE.md",
    ".thoth/.gitignore",
    ".thoth/objects/project/",
    ".thoth/objects/work_item/",
    ".thoth/objects/discussion/",
    ".thoth/objects/decision/",
    ".thoth/extensions/",
    ".thoth/docs/agent-entry.md",
    ".thoth/docs/project.json",
    ".thoth/docs/source-map.json",
)

LOCAL_RUNTIME_PATHS = (
    ".thoth/runs/",
    ".thoth/derived/",
    ".thoth/docs/work-results/",
    ".thoth/objects/run/",
    ".thoth/objects/artifact/",
    ".thoth/objects/controller/",
    ".thoth/objects/phase_result/",
)

ROOT_GITIGNORE_RULES = (
    "/research.db",
    "/research.db-*",
    "/.pytest_cache/",
    "__pycache__/",
    "*.py[cod]",
)

THOTH_GITIGNORE_RULES = (
    "/runs/",
    "/derived/",
    "/docs/work-results/",
    "/objects/run/",
    "/objects/artifact/",
    "/objects/controller/",
    "/objects/phase_result/",
    "/local/",
    "/local-state/",
)

DASHBOARD_GITIGNORE_RULES = (
    "research.db",
    "research.db-*",
    "*.db",
    "*.sqlite",
    "*.sqlite3",
)

DASHBOARD_FRONTEND_GITIGNORE_RULES = (
    "node_modules/",
    "dist/",
    ".vite/",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*",
    "pnpm-debug.log*",
)

DASHBOARD_BACKEND_GITIGNORE_RULES = (
    "__pycache__/",
    "*.py[cod]",
    ".pytest_cache/",
    "*.log",
)


def _append_gitignore_rules(path: Path, *, section: str, rules: tuple[str, ...]) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    existing_lines = {line.strip() for line in existing.splitlines()}
    missing = [rule for rule in rules if rule not in existing_lines]
    if not missing:
        return False

    pieces: list[str] = []
    if existing and not existing.endswith("\n"):
        pieces.append("\n")
    if existing.strip():
        pieces.append("\n")
    if section not in existing:
        pieces.append(f"# {section}\n")
    pieces.append("\n".join(missing))
    pieces.append("\n")
    with path.open("a", encoding="utf-8") as handle:
        handle.write("".join(pieces))
    return True


def ensure_project_gitignore_rules(project_root: Path) -> list[str]:
    """Append Thoth ignore rules without overwriting user-owned ignore files."""

    changed: list[str] = []
    targets = (
        (project_root / ".gitignore", "Thoth local dashboard/runtime cache", ROOT_GITIGNORE_RULES),
        (project_root / ".thoth" / ".gitignore", "Thoth local runtime state and evidence", THOTH_GITIGNORE_RULES),
        (project_root / "tools" / "dashboard" / ".gitignore", "Thoth dashboard local cache", DASHBOARD_GITIGNORE_RULES),
        (
            project_root / "tools" / "dashboard" / "frontend" / ".gitignore",
            "Thoth dashboard frontend local dependencies",
            DASHBOARD_FRONTEND_GITIGNORE_RULES,
        ),
        (
            project_root / "tools" / "dashboard" / "backend" / ".gitignore",
            "Thoth dashboard backend local cache",
            DASHBOARD_BACKEND_GITIGNORE_RULES,
        ),
    )
    for path, section, rules in targets:
        if _append_gitignore_rules(path, section=section, rules=rules):
            changed.append(str(path.relative_to(project_root)))
    return changed
