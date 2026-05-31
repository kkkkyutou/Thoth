"""Privacy lint helpers for public Thoth artifacts and extension plugins."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


SKIP_DIRS = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tmp_pytest",
    "__pycache__",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
}
SKIP_SUFFIXES = {
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".pyc",
    ".svgz",
    ".webp",
}


@dataclass(frozen=True)
class PrivacyFinding:
    path: str
    line: int
    kind: str
    match: str
    detail: str

    def format(self) -> str:
        return f"{self.path}:{self.line}: {self.kind}: {self.detail} ({self.match})"


PUBLIC_PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("private_project_name", re.compile(r"(?i)\b" "3d" r"lmm\b"), "downstream project name"),
    ("private_work_id", re.compile(r"\b" "EVA" r"00\b|\b" "eva" r"00\b"), "downstream work id family"),
    ("private_workspace_path", re.compile(r"/mnt" r"/cfs(?:/[^\s\"'`),\]}]+)?"), "machine workspace path"),
    ("private_temp_path", re.compile(r"/tmp/" "3d" r"lmm(?:/[^\s\"'`),\]}]+)?"), "downstream temp path"),
    (
        "private_conda_env",
        re.compile(r"/opt/conda/envs/" "3d" r"lmm(?:/[^\s\"'`),\]}]+)?"),
        "downstream conda environment",
    ),
    ("private_metric_count", re.compile(r"\b(?:" "500" r"20|" "425" r"85)\+?\b"), "downstream metric record count"),
    ("private_teaser_title", re.compile("Synth" "etic LLM Training Demo"), "non-demo teaser title"),
)

PLUGIN_EXTRA_PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    (
        "absolute_user_path",
        re.compile(r"/(?:home|Users|root)/[^\s\"'`),\]}]+"),
        "absolute user-local path in plugin artifact",
    ),
    (
        "non_demo_conda_env",
        re.compile(r"/opt/conda/envs/(?!thoth-demo\b)[A-Za-z0-9_.-]+(?:/[^\s\"'`),\]}]+)?"),
        "non-demo conda environment in plugin artifact",
    ),
)


def _display_path(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def _is_probably_text(path: Path) -> bool:
    if path.suffix.lower() in SKIP_SUFFIXES:
        return False
    try:
        chunk = path.read_bytes()[:4096]
    except OSError:
        return False
    return b"\0" not in chunk


def _iter_files(root: Path) -> Iterable[Path]:
    root = root.resolve()
    if (root / ".git").exists():
        try:
            result = subprocess.run(
                ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                cwd=root,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            for raw in result.stdout.split(b"\0"):
                if raw:
                    yield root / raw.decode("utf-8", errors="replace")
            return
        except (OSError, subprocess.CalledProcessError):
            pass
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        yield path


def scan_file(
    path: Path,
    *,
    root: Path,
    plugin_mode: bool = False,
) -> list[PrivacyFinding]:
    findings: list[PrivacyFinding] = []
    rel = _display_path(path, root)
    patterns = PUBLIC_PATTERNS + (PLUGIN_EXTRA_PATTERNS if plugin_mode else ())
    for kind, pattern, detail in patterns:
        for match in pattern.finditer(rel):
            findings.append(PrivacyFinding(rel, 0, kind, match.group(0), detail))
    if not path.exists() or not path.is_file() or not _is_probably_text(path):
        return findings
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return findings
    for line_no, line in enumerate(content.splitlines(), start=1):
        for kind, pattern, detail in patterns:
            for match in pattern.finditer(line):
                findings.append(PrivacyFinding(rel, line_no, kind, match.group(0), detail))
    return findings


def scan_paths(paths: Iterable[Path], *, root: Path, plugin_mode: bool = False) -> list[PrivacyFinding]:
    findings: list[PrivacyFinding] = []
    for path in paths:
        findings.extend(scan_file(path, root=root, plugin_mode=plugin_mode))
    return findings


def scan_tree(root: Path, *, plugin_mode: bool = False) -> list[PrivacyFinding]:
    findings = scan_paths(_iter_files(root), root=root, plugin_mode=plugin_mode)
    if not plugin_mode:
        findings.extend(scan_teaser_provenance(root))
    return findings


def scan_teaser_provenance(root: Path) -> list[PrivacyFinding]:
    root = root.resolve()
    provenance_path = root / "assets" / "thoth-teaser-v4.provenance.json"
    expected_assets = {
        "assets/thoth-dashboard-teaser-v4.png",
        "assets/thoth-tui-teaser-v4.png",
    }
    if not any((root / asset).exists() for asset in expected_assets):
        return []
    if not provenance_path.exists():
        return [
            PrivacyFinding(
                "assets/thoth-teaser-v4.provenance.json",
                0,
                "teaser_provenance_missing",
                "assets/*teaser-v4.png",
                "v4 teaser assets require demo-only provenance",
            )
        ]
    try:
        payload = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [
            PrivacyFinding(
                _display_path(provenance_path, root),
                0,
                "teaser_provenance_invalid",
                str(exc),
                "v4 teaser provenance must be valid JSON",
            )
        ]
    rows = payload.get("teasers") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return [
            PrivacyFinding(
                _display_path(provenance_path, root),
                0,
                "teaser_provenance_invalid",
                "teasers",
                "v4 teaser provenance must contain a teasers list",
            )
        ]
    by_asset = {str(row.get("asset")): row for row in rows if isinstance(row, dict)}
    findings: list[PrivacyFinding] = []
    for asset in sorted(expected_assets):
        row = by_asset.get(asset)
        if not row:
            findings.append(
                PrivacyFinding(
                    _display_path(provenance_path, root),
                    0,
                    "teaser_provenance_missing_asset",
                    asset,
                    "v4 teaser asset is missing provenance",
                )
            )
            continue
        if row.get("source_fixture") != "tests/fixtures/dashboard_demo":
            findings.append(
                PrivacyFinding(
                    _display_path(provenance_path, root),
                    0,
                    "teaser_provenance_source",
                    str(row.get("source_fixture")),
                    "v4 teaser asset must be generated from the dashboard demo fixture",
                )
            )
        if row.get("generated_from_real_task_project") is not False:
            findings.append(
                PrivacyFinding(
                    _display_path(provenance_path, root),
                    0,
                    "teaser_provenance_real_project",
                    str(row.get("generated_from_real_task_project")),
                    "v4 teaser asset must not come from a downstream task project",
                )
            )
    return findings


def scan_plugin_tree(project_root: Path) -> list[PrivacyFinding]:
    paths: list[Path] = []
    manifest = project_root / ".thoth" / "extensions" / "manifest.json"
    if manifest.exists():
        paths.append(manifest)
    plugins_root = project_root / ".thoth" / "extensions" / "plugins"
    if plugins_root.exists():
        paths.extend(path for path in plugins_root.rglob("*") if path.is_file())
    return scan_paths(paths, root=project_root, plugin_mode=True)


def finding_messages(findings: Iterable[PrivacyFinding]) -> list[str]:
    return [finding.format() for finding in findings]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan Thoth public artifacts for private downstream project data.")
    parser.add_argument("root", nargs="?", default=".", help="Repository or plugin root to scan.")
    parser.add_argument("--plugin", action="store_true", help="Enable stricter plugin artifact path checks.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    args = parser.parse_args(argv)

    root = Path(args.root)
    findings = scan_tree(root, plugin_mode=args.plugin)
    if args.json:
        print(json.dumps({"ok": not findings, "findings": [asdict(row) for row in findings]}, indent=2))
    elif findings:
        for finding in findings:
            print(finding.format())
    else:
        print("privacy scan passed")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
