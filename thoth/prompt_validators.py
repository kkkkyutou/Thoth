"""Runtime validation helpers for Thoth prompt-driven phase and review outputs."""

from __future__ import annotations

import re
import json
from typing import Any

from .prompt_specs import phase_prompt_spec


PHASE_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "plan": (
        "summary",
        "authority_complete",
        "authority_coverage",
        "open_gaps",
        "forbidden_assumptions_used",
        "execution_steps",
        "files_expected",
        "commands_expected",
        "validation_plan",
        "risk_assessment",
    ),
    "execute": ("summary", "plan_artifact_read", "plan_deviations", "files_touched", "commands_run", "artifacts"),
    "validate": ("summary", "passed", "metric_name", "metric_value", "threshold", "checks"),
    "reflect": ("summary", "outcome", "residual_risks", "evidence", "next_recommendation"),
}

REVIEW_SUMMARY_LIMIT = 48
REVIEW_TITLE_LIMIT = 32
LIST_SHORT_ITEM_LIMIT = 96
COMMAND_ITEM_LIMIT = 160
PLAN_ITEM_LIMIT = 240
NEXT_HINT_LIMIT = 160
ROOT_CAUSE_LIMIT = 240
FAILURE_CLASS_LIMIT = 32
METRIC_NAME_LIMIT = 80
RISK_LIMIT = 240


def utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


def _contains_markdown(text: str) -> bool:
    stripped = text.strip()
    if "\n" in stripped or "\r" in stripped:
        return True
    return bool(
        re.search(r"(^[#>*-]\s)|(```)|(\[[^\]]+\]\()|(^\d+\.\s)", stripped, flags=re.MULTILINE)
    )


def _require_short_text(field: str, value: Any, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    text = value.strip()
    if not text:
        raise ValueError(f"{field} must not be empty")
    if _contains_markdown(text):
        raise ValueError(f"{field} must be plain single-line text")
    if utf8_len(text) > limit:
        raise ValueError(f"{field} exceeds {limit} UTF-8 bytes")
    return text


def _require_string_list(field: str, value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    return [_require_short_text(f"{field}[{index}]", item, limit) for index, item in enumerate(value)]


def _truncate_utf8_single_line(text: str, limit: int) -> tuple[str, bool]:
    single_line = re.sub(r"\s+", " ", text).strip()
    if utf8_len(single_line) <= limit:
        return single_line, single_line != text.strip()
    suffix = "..."
    budget = max(0, limit - utf8_len(suffix))
    raw = single_line.encode("utf-8")[:budget]
    while raw:
        try:
            truncated = raw.decode("utf-8")
            return truncated + suffix, True
        except UnicodeDecodeError:
            raw = raw[:-1]
    return suffix[:limit], True


def _compact_json_string(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    except (TypeError, ValueError):
        return str(value)


def _normalize_jsonish_string_list(
    field: str,
    value: Any,
    limit: int,
    *,
    warnings: list[dict[str, Any]],
) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    rows: list[str] = []
    for index, item in enumerate(value):
        warning: dict[str, Any] | None = None
        if isinstance(item, str):
            text = item
        else:
            text = _compact_json_string(item)
            warning = {
                "field": field,
                "index": index,
                "reason": "coerced_to_json_string",
                "original_type": type(item).__name__,
            }
        normalized, changed = _truncate_utf8_single_line(text, limit)
        if changed:
            if warning is None:
                warning = {
                    "field": field,
                    "index": index,
                    "reason": "normalized_single_line",
                    "original_type": type(item).__name__,
                }
            else:
                warning["truncated_or_compacted"] = True
            warning["limit_utf8_bytes"] = limit
            warning["original_utf8_bytes"] = utf8_len(str(text))
        if not normalized:
            if warning is None:
                warning = {
                    "field": field,
                    "index": index,
                    "reason": "empty_item_normalized",
                    "original_type": type(item).__name__,
                }
            warning["limit_utf8_bytes"] = limit
        if warning is not None:
            warnings.append(warning)
        rows.append(normalized)
    return rows


def _require_plan_field(field: str, value: Any, limit: int) -> Any:
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        normalized: list[Any] = []
        for index, item in enumerate(value):
            if isinstance(item, dict):
                normalized.append(item)
            else:
                normalized.append(_require_short_text(f"{field}[{index}]", item, limit))
        return normalized
    return _require_short_text(field, value, limit)


def _require_check_list(field: str, value: Any, *, limit: int) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"{field}[{index}] must be an object")
        normalized: dict[str, Any] = {}
        name = item.get("name")
        ok = item.get("ok")
        if name is not None:
            normalized["name"] = _require_short_text(f"{field}[{index}].name", name, limit)
        if ok is not None:
            if not isinstance(ok, bool):
                raise ValueError(f"{field}[{index}].ok must be a boolean")
            normalized["ok"] = ok
        for key in ("detail", "summary"):
            raw = item.get(key)
            if raw is not None:
                normalized[key] = _require_short_text(f"{field}[{index}].{key}", raw, limit)
        for key, raw in item.items():
            if key not in {"name", "ok", "detail", "summary"}:
                normalized[key] = raw
        rows.append(normalized)
    return rows


def _require_bool(field: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be a boolean")
    return value


def validate_phase_output(
    phase: str,
    payload: dict[str, Any],
    *,
    validate_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError(f"{phase} output must be an object")
    required = PHASE_REQUIRED_FIELDS[phase]
    missing = [field for field in required if field not in payload]
    if missing:
        raise ValueError(f"{phase} output missing required fields: {', '.join(missing)}")

    normalized = dict(payload)
    normalized["summary"] = _require_short_text(
        f"{phase}.summary",
        payload.get("summary"),
        phase_prompt_spec(phase).summary_budget_utf8,
    )
    if phase == "plan":
        normalization_warnings: list[dict[str, Any]] = []
        normalized["authority_complete"] = _require_bool("plan.authority_complete", payload.get("authority_complete"))
        coverage = payload.get("authority_coverage")
        if not isinstance(coverage, (list, dict)):
            raise ValueError("plan.authority_coverage must be a list or object")
        normalized["authority_coverage"] = coverage
        normalized["open_gaps"] = _normalize_jsonish_string_list(
            "plan.open_gaps",
            payload.get("open_gaps"),
            ROOT_CAUSE_LIMIT,
            warnings=normalization_warnings,
        )
        normalized["forbidden_assumptions_used"] = _normalize_jsonish_string_list(
            "plan.forbidden_assumptions_used",
            payload.get("forbidden_assumptions_used"),
            ROOT_CAUSE_LIMIT,
            warnings=normalization_warnings,
        )
        normalized["execution_steps"] = _require_string_list(
            "plan.execution_steps",
            payload.get("execution_steps"),
            PLAN_ITEM_LIMIT,
        )
        normalized["files_expected"] = _require_plan_field("plan.files_expected", payload.get("files_expected"), COMMAND_ITEM_LIMIT)
        normalized["commands_expected"] = _require_plan_field("plan.commands_expected", payload.get("commands_expected"), COMMAND_ITEM_LIMIT)
        validation_plan = payload.get("validation_plan")
        if isinstance(validation_plan, dict):
            normalized["validation_plan"] = validation_plan
        else:
            normalized["validation_plan"] = _require_short_text("plan.validation_plan", validation_plan, ROOT_CAUSE_LIMIT)
        normalized["risk_assessment"] = _require_plan_field("plan.risk_assessment", payload.get("risk_assessment"), RISK_LIMIT)
        normalized["_normalization_warnings"] = normalization_warnings
        return normalized
    if phase == "execute":
        normalized["plan_artifact_read"] = _require_bool("execute.plan_artifact_read", payload.get("plan_artifact_read"))
        if not normalized["plan_artifact_read"]:
            raise ValueError("execute.plan_artifact_read must be true")
        normalized["plan_deviations"] = _require_string_list(
            "execute.plan_deviations",
            payload.get("plan_deviations"),
            ROOT_CAUSE_LIMIT,
        )
        if not isinstance(payload.get("files_touched"), list):
            raise ValueError("execute.files_touched must be a list")
        if not isinstance(payload.get("artifacts"), list):
            raise ValueError("execute.artifacts must be a list")
        normalized["commands_run"] = _require_string_list(
            "execute.commands_run",
            payload.get("commands_run"),
            COMMAND_ITEM_LIMIT,
        )
        normalized["files_touched"] = payload.get("files_touched")
        normalized["artifacts"] = payload.get("artifacts")
        return normalized
    if phase == "validate":
        if not isinstance(payload.get("passed"), bool):
            raise ValueError("validate.passed must be a boolean")
        normalized["metric_name"] = _require_short_text(
            "validate.metric_name",
            payload.get("metric_name"),
            METRIC_NAME_LIMIT,
        )
        normalized["checks"] = _require_check_list("validate.checks", payload.get("checks"), limit=LIST_SHORT_ITEM_LIMIT)
        if validate_schema and validate_schema.get("type") == "object":
            required_fields = validate_schema.get("required")
            if isinstance(required_fields, list):
                missing_schema_fields = [field for field in required_fields if field not in normalized]
                if missing_schema_fields:
                    raise ValueError(
                        "validate output missing schema-required fields: "
                        + ", ".join(str(field) for field in missing_schema_fields)
                    )
        return normalized
    if phase == "reflect":
        outcome = str(payload.get("outcome") or "").strip().lower()
        if outcome not in {"passed", "failed"}:
            raise ValueError("reflect.outcome must be passed|failed")
        normalized["outcome"] = outcome
        normalized["residual_risks"] = _require_string_list(
            "reflect.residual_risks",
            payload.get("residual_risks"),
            ROOT_CAUSE_LIMIT,
        )
        normalized["evidence"] = _require_string_list(
            "reflect.evidence",
            payload.get("evidence"),
            ROOT_CAUSE_LIMIT,
        )
        normalized["next_recommendation"] = _require_short_text(
            "reflect.next_recommendation",
            payload.get("next_recommendation"),
            ROOT_CAUSE_LIMIT,
        )
        if outcome == "failed":
            for field, limit in (
                ("failure_class", FAILURE_CLASS_LIMIT),
                ("root_cause", ROOT_CAUSE_LIMIT),
                ("next_plan_hint", NEXT_HINT_LIMIT),
            ):
                if field not in payload:
                    raise ValueError(f"reflect output missing required failure field: {field}")
                normalized[field] = _require_short_text(f"reflect.{field}", payload.get(field), limit)
        elif any(field in payload for field in ("failure_class", "root_cause", "next_plan_hint")):
            for field, limit in (
                ("failure_class", FAILURE_CLASS_LIMIT),
                ("root_cause", ROOT_CAUSE_LIMIT),
                ("next_plan_hint", NEXT_HINT_LIMIT),
            ):
                if field in payload:
                    normalized[field] = _require_short_text(f"reflect.{field}", payload.get(field), limit)
        return normalized
    raise ValueError(f"unsupported phase: {phase}")


def _dedupe_review_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, int | None, str, str, str]] = set()
    for finding in findings:
        key = (
            str(finding.get("path") or "").strip(),
            finding.get("line") if isinstance(finding.get("line"), int) else None,
            str(finding.get("title") or "").strip().lower(),
            str(finding.get("summary") or "").strip().lower(),
            str(finding.get("severity") or "").strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(finding)
    return deduped


def validate_review_result_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("review result payload must be an object")
    normalized = dict(payload)
    normalized["summary"] = _require_short_text("review.summary", payload.get("summary"), REVIEW_SUMMARY_LIMIT)
    findings = payload.get("findings")
    if not isinstance(findings, list):
        raise ValueError("review.findings must be a list")
    normalized_findings: list[dict[str, Any]] = []
    for index, item in enumerate(findings):
        if not isinstance(item, dict):
            raise ValueError(f"review.findings[{index}] must be an object")
        severity = str(item.get("severity") or "").strip().lower()
        if severity not in {"high", "medium", "low"}:
            raise ValueError(f"review.findings[{index}].severity must be high|medium|low")
        title = _require_short_text(f"review.findings[{index}].title", item.get("title"), REVIEW_TITLE_LIMIT)
        summary = _require_short_text(
            f"review.findings[{index}].summary",
            item.get("summary"),
            REVIEW_SUMMARY_LIMIT,
        )
        path = item.get("path")
        if not isinstance(path, str) or not path.strip():
            raise ValueError(f"review.findings[{index}].path must be a non-empty string")
        finding: dict[str, Any] = {
            "severity": severity,
            "title": title,
            "path": path.strip(),
            "summary": summary,
        }
        if "line" in item and item.get("line") is not None:
            if not isinstance(item.get("line"), int):
                raise ValueError(f"review.findings[{index}].line must be an integer")
            finding["line"] = int(item.get("line"))
        normalized_findings.append(finding)
    normalized["findings"] = _dedupe_review_findings(normalized_findings)
    return normalized


__all__ = [
    "COMMAND_ITEM_LIMIT",
    "FAILURE_CLASS_LIMIT",
    "LIST_SHORT_ITEM_LIMIT",
    "METRIC_NAME_LIMIT",
    "NEXT_HINT_LIMIT",
    "PHASE_REQUIRED_FIELDS",
    "REVIEW_SUMMARY_LIMIT",
    "REVIEW_TITLE_LIMIT",
    "ROOT_CAUSE_LIMIT",
    "utf8_len",
    "validate_phase_output",
    "validate_review_result_payload",
]
