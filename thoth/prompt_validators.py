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
        "open_gaps",
        "history_action",
        "plan",
    ),
    "execute": ("summary", "report", "official_validation_receipt"),
    "validate": ("summary", "passed", "metric_name", "metric_value", "threshold", "checks"),
    "reflect": ("summary", "outcome", "review"),
}

PHASE_ALLOWED_FIELDS: dict[str, set[str]] = {
    "plan": {"summary", "authority_complete", "open_gaps", "history_action", "plan", "_normalization_warnings"},
    "execute": {"summary", "report", "official_validation_receipt", "_normalization_warnings"},
    "validate": {
        "summary",
        "passed",
        "metric_name",
        "metric_value",
        "threshold",
        "checks",
        "official_validation_receipt",
        "execute_summary",
        "observed_validation",
        "runtime_contract_health",
        "failure_class",
        "acceptance_state",
        "_normalization_warnings",
    },
    "reflect": {"summary", "outcome", "review", "retry_authorized", "corrective_prompt", "_normalization_warnings"},
}

REVIEW_SUMMARY_LIMIT = 48
REVIEW_TITLE_LIMIT = 32
LIST_SHORT_ITEM_LIMIT = 1024
COMMAND_ITEM_LIMIT = 1024
PLAN_ITEM_LIMIT = 1024
NEXT_HINT_LIMIT = 1200
ROOT_CAUSE_LIMIT = 1200
CORRECTIVE_PROMPT_LIMIT = 2000
FAILURE_CLASS_LIMIT = 32
METRIC_NAME_LIMIT = 80
RISK_LIMIT = 1200
STRUCTURED_FIELD_TOTAL_LIMIT = 4096
PHASE_BODY_LIMIT = 12000


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


def _truncate_utf8_preserve_text(text: str, limit: int) -> tuple[str, bool]:
    raw_text = text.strip()
    if utf8_len(raw_text) <= limit:
        return raw_text, raw_text != text
    suffix = "\n...[truncated]"
    budget = max(0, limit - utf8_len(suffix))
    raw = raw_text.encode("utf-8")[:budget]
    while raw:
        try:
            return raw.decode("utf-8").rstrip() + suffix, True
        except UnicodeDecodeError:
            raw = raw[:-1]
    return suffix[:limit], True


def _compact_json_string(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    except (TypeError, ValueError):
        return str(value)


def _add_normalization_warning(
    warnings: list[dict[str, Any]],
    *,
    field: str,
    reason: str,
    original_type: str,
    limit: int,
    original_utf8_bytes: int | None = None,
    index: int | None = None,
    truncated_or_compacted: bool = False,
) -> None:
    warning: dict[str, Any] = {
        "field": field,
        "reason": reason,
        "original_type": original_type,
        "limit_utf8_bytes": limit,
    }
    if index is not None:
        warning["index"] = index
    if original_utf8_bytes is not None:
        warning["original_utf8_bytes"] = original_utf8_bytes
    if truncated_or_compacted:
        warning["truncated_or_compacted"] = True
    warnings.append(warning)


def _existing_normalization_warnings(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("_normalization_warnings")
    return [dict(item) for item in rows if isinstance(item, dict)] if isinstance(rows, list) else []


def _normalize_text_field(
    field: str,
    value: Any,
    limit: int,
    *,
    warnings: list[dict[str, Any]],
    coerce_jsonish: bool = False,
    required: bool = True,
    warning_field: str | None = None,
    index: int | None = None,
) -> str:
    original_type = type(value).__name__
    coerced = False
    if isinstance(value, str):
        raw = value
    elif coerce_jsonish:
        raw = _compact_json_string(value)
        coerced = True
    else:
        raise ValueError(f"{field} must be a string")
    normalized, changed = _truncate_utf8_single_line(raw, limit)
    if required and not normalized:
        raise ValueError(f"{field} must not be empty")
    if changed or coerced:
        reason = "coerced_to_json_string" if coerced else "normalized_single_line"
        _add_normalization_warning(
            warnings,
            field=warning_field or field,
            index=index,
            reason=reason,
            original_type=original_type,
            limit=limit,
            original_utf8_bytes=utf8_len(str(raw)),
            truncated_or_compacted=changed and coerced,
        )
    return normalized


def _normalize_body_field(
    field: str,
    value: Any,
    limit: int,
    *,
    warnings: list[dict[str, Any]],
    required: bool = True,
) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    normalized, changed = _truncate_utf8_preserve_text(value, limit)
    if required and not normalized:
        raise ValueError(f"{field} must not be empty")
    if changed:
        _add_normalization_warning(
            warnings,
            field=field,
            reason="body_truncated",
            original_type=type(value).__name__,
            limit=limit,
            original_utf8_bytes=utf8_len(value),
            truncated_or_compacted=True,
        )
    return normalized


def _normalize_text_list(
    field: str,
    value: Any,
    limit: int,
    *,
    warnings: list[dict[str, Any]],
    coerce_jsonish: bool = True,
) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    return [
        _normalize_text_field(
            f"{field}[{index}]",
            item,
            limit,
            warnings=warnings,
            coerce_jsonish=coerce_jsonish,
            required=False,
            warning_field=field,
            index=index,
        )
        for index, item in enumerate(value)
    ]


def _normalize_structured_value(
    field: str,
    value: Any,
    *,
    item_limit: int,
    warnings: list[dict[str, Any]],
) -> Any:
    if isinstance(value, str):
        return _normalize_text_field(field, value, item_limit, warnings=warnings, required=False)
    if isinstance(value, list):
        return [
            _normalize_structured_value(
                f"{field}[{index}]",
                item,
                item_limit=item_limit,
                warnings=warnings,
            )
            for index, item in enumerate(value)
        ]
    if isinstance(value, dict):
        return {
            str(key): _normalize_structured_value(
                f"{field}.{key}",
                item,
                item_limit=item_limit,
                warnings=warnings,
            )
            for key, item in value.items()
        }
    return value


def _normalize_flexible_field(
    field: str,
    value: Any,
    *,
    scalar_limit: int,
    item_limit: int,
    total_limit: int = STRUCTURED_FIELD_TOTAL_LIMIT,
    warnings: list[dict[str, Any]],
) -> Any:
    if isinstance(value, (dict, list)):
        normalized = _normalize_structured_value(field, value, item_limit=item_limit, warnings=warnings)
        compact = _compact_json_string(normalized)
        compact_len = utf8_len(compact)
        if compact_len > total_limit:
            truncated, _changed = _truncate_utf8_single_line(compact, total_limit)
            _add_normalization_warning(
                warnings,
                field=field,
                reason="structured_total_truncated",
                original_type=type(value).__name__,
                limit=total_limit,
                original_utf8_bytes=compact_len,
                truncated_or_compacted=True,
            )
            return truncated
        return normalized
    return _normalize_text_field(field, value, scalar_limit, warnings=warnings)


def _normalize_mixed_list(
    field: str,
    value: Any,
    *,
    item_limit: int,
    warnings: list[dict[str, Any]],
) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    normalized: list[Any] = []
    for index, item in enumerate(value):
        item_field = f"{field}[{index}]"
        if isinstance(item, str):
            normalized.append(
                _normalize_text_field(
                    item_field,
                    item,
                    item_limit,
                    warnings=warnings,
                    required=False,
                    warning_field=field,
                    index=index,
                )
            )
        elif isinstance(item, (dict, list)):
            normalized.append(
                _normalize_flexible_field(
                    item_field,
                    item,
                    scalar_limit=item_limit,
                    item_limit=item_limit,
                    warnings=warnings,
                )
            )
        else:
            normalized.append(item)
    return normalized


def _normalize_jsonish_string_list(
    field: str,
    value: Any,
    limit: int,
    *,
    warnings: list[dict[str, Any]],
) -> list[str]:
    return _normalize_text_list(field, value, limit, warnings=warnings, coerce_jsonish=True)


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


def _require_check_list(
    field: str,
    value: Any,
    *,
    limit: int,
    warnings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
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
            normalized["name"] = _normalize_text_field(
                f"{field}[{index}].name",
                name,
                limit,
                warnings=warnings,
                required=False,
            )
        if ok is not None:
            if not isinstance(ok, bool):
                raise ValueError(f"{field}[{index}].ok must be a boolean")
            normalized["ok"] = ok
        for key in ("detail", "summary"):
            raw = item.get(key)
            if raw is not None:
                normalized[key] = _normalize_text_field(
                    f"{field}[{index}].{key}",
                    raw,
                    limit,
                    warnings=warnings,
                    required=False,
                )
        for key, raw in item.items():
            if key not in {"name", "ok", "detail", "summary"}:
                normalized[key] = raw
        rows.append(normalized)
    return rows


def _require_bool(field: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be a boolean")
    return value


def _check_passed(check: dict[str, Any]) -> bool | None:
    for key in ("ok", "passed"):
        value = check.get(key)
        if isinstance(value, bool):
            return value
    return None


def _first_failed_validate_check(validate_payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(validate_payload, dict):
        return {}
    checks = validate_payload.get("checks")
    if not isinstance(checks, list):
        return {}
    for check in checks:
        if not isinstance(check, dict):
            continue
        if _check_passed(check) is False:
            return check
    return {}


def _validate_text_for_failure(validate_payload: dict[str, Any] | None, failed_check: dict[str, Any]) -> str:
    parts: list[str] = []
    for source in (failed_check, validate_payload if isinstance(validate_payload, dict) else {}):
        if not isinstance(source, dict):
            continue
        for key in ("name", "details", "detail", "summary"):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return " ".join(parts)


def _infer_failure_class(validate_payload: dict[str, Any] | None, failed_check: dict[str, Any]) -> str:
    if isinstance(validate_payload, dict):
        for key in ("failure_class", "runtime_contract_health"):
            if validate_payload.get(key) == "runtime_contract_error":
                return "runtime_contract_error"
    text = _validate_text_for_failure(validate_payload, failed_check).lower()
    if any(marker in text for marker in ("module not found", "modulenotfounderror", "no module named", "importerror")):
        return "dependency_missing"
    if any(marker in text for marker in ("timed out", "timeout", "exit 124")):
        return "dependency_timeout"
    if any(marker in text for marker in ("permission denied", "not permitted")):
        return "permission_blocked"
    if isinstance(validate_payload, dict) and validate_payload.get("passed") is False:
        metric_value = validate_payload.get("metric_value")
        threshold = validate_payload.get("threshold")
        if metric_value is not None and threshold is not None:
            return "metric_not_reached"
    return "validation_failed"


def _synthesize_reflect_failure_fields(
    payload: dict[str, Any],
    *,
    prior_validate_payload: dict[str, Any] | None,
    warnings: list[dict[str, Any]],
) -> dict[str, Any]:
    if str(payload.get("outcome") or "").strip().lower() != "failed":
        return payload
    missing = [
        field
        for field in ("failure_class", "root_cause", "corrective_prompt", "retry_authorized")
        if field not in payload
    ]
    if not missing:
        return payload
    failed_check = _first_failed_validate_check(prior_validate_payload)
    failure_class = _infer_failure_class(prior_validate_payload, failed_check)
    root_source = _validate_text_for_failure(prior_validate_payload, failed_check)
    if not root_source and isinstance(prior_validate_payload, dict):
        root_source = str(prior_validate_payload.get("summary") or "")
    root_cause = root_source or "validation failed; no detailed failed check was available"
    check_name = failed_check.get("name") if isinstance(failed_check.get("name"), str) else ""
    runtime_contract_error = failure_class == "runtime_contract_error"
    if runtime_contract_error:
        next_hint = "fix the Thoth runtime receipt contract or reconcile the run; do not edit the project implementation"
    elif check_name:
        next_hint = f"repair validation failure in {check_name} and rerun the official validator"
    else:
        next_hint = "repair the validation failure and rerun the official validator"
    synthesized = dict(payload)
    synthesized.setdefault("failure_class", failure_class)
    synthesized.setdefault("root_cause", root_cause)
    if "next_plan_hint" in payload:
        synthesized.setdefault("next_plan_hint", next_hint)
    if runtime_contract_error:
        synthesized.setdefault(
            "corrective_prompt",
            (
                "Do not retry execute and do not edit project code for this failure. "
                f"The validate evidence points to Thoth runtime receipt/log contract hygiene: {root_cause}. "
                "Fix the runtime contract or use the explicit reconcile path for a historical run whose official validator already passed."
            ),
        )
    else:
        synthesized.setdefault(
            "corrective_prompt",
            (
                "Do not weaken the validator, metric, threshold, or work goal. "
                f"Repair the implementation issue shown by validate evidence: {root_cause}. "
                "Continue as a senior engineer, debug the concrete failure, rerun focused checks, "
                "then rerun the official validator in the same runtime environment and return a fresh official_validation_receipt."
            ),
        )
    synthesized.setdefault("retry_authorized", not runtime_contract_error)
    for field in missing:
        _add_normalization_warning(
            warnings,
            field=f"reflect.{field}",
            reason="synthesized_from_validate_evidence",
            original_type="missing",
            limit=FAILURE_CLASS_LIMIT if field == "failure_class" else CORRECTIVE_PROMPT_LIMIT if field == "corrective_prompt" else ROOT_CAUSE_LIMIT,
            truncated_or_compacted=True,
        )
    return synthesized


def _normalize_reflect_outcome(value: Any, warnings: list[dict[str, Any]]) -> str:
    aliases = {
        "pass": "passed",
        "passes": "passed",
        "success": "passed",
        "succeeded": "passed",
        "ok": "passed",
        "fail": "failed",
        "fails": "failed",
        "failure": "failed",
        "error": "failed",
    }
    if isinstance(value, str):
        outcome = value.strip().lower()
        return aliases.get(outcome, outcome)
    if isinstance(value, dict):
        for key in ("outcome", "status", "result", "verdict", "state"):
            nested = value.get(key)
            if isinstance(nested, str):
                outcome = aliases.get(nested.strip().lower(), nested.strip().lower())
                if outcome in {"passed", "failed"}:
                    _add_normalization_warning(
                        warnings,
                        field="reflect.outcome",
                        reason="object_outcome_normalized",
                        original_type="dict",
                        limit=FAILURE_CLASS_LIMIT,
                        truncated_or_compacted=True,
                    )
                    return outcome
    return str(value or "").strip().lower()


def _markdown_items(title: str, value: Any) -> list[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, list):
        rows = [f"- {str(item).strip()}" for item in value if str(item).strip()]
        return [f"## {title}", *rows] if rows else []
    if isinstance(value, dict):
        compact = _compact_json_string(value)
        return [f"## {title}", compact] if compact else []
    text = str(value).strip()
    return [f"## {title}", text] if text else []


def _compat_phase_payload(phase: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Reject legacy worker fields for new outputs; historical artifacts are read-only compatible elsewhere."""
    return dict(payload)


def validate_phase_output(
    phase: str,
    payload: dict[str, Any],
    *,
    validate_schema: dict[str, Any] | None = None,
    prior_validate_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError(f"{phase} output must be an object")
    payload = _compat_phase_payload(phase, payload)
    allowed = PHASE_ALLOWED_FIELDS.get(phase, set())
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ValueError(f"{phase} output has unknown fields: {', '.join(unknown)}")
    required = PHASE_REQUIRED_FIELDS[phase]
    missing = [field for field in required if field not in payload]
    if missing:
        raise ValueError(f"{phase} output missing required fields: {', '.join(missing)}")

    normalized = dict(payload)
    normalization_warnings: list[dict[str, Any]] = []
    normalized["summary"] = _normalize_text_field(
        f"{phase}.summary",
        payload.get("summary"),
        phase_prompt_spec(phase).summary_budget_utf8,
        warnings=normalization_warnings,
    )
    if phase == "plan":
        normalized["authority_complete"] = _require_bool("plan.authority_complete", payload.get("authority_complete"))
        normalized["open_gaps"] = _normalize_jsonish_string_list(
            "plan.open_gaps",
            payload.get("open_gaps"),
            PLAN_ITEM_LIMIT,
            warnings=normalization_warnings,
        )
        history_action = _require_short_text("plan.history_action", payload.get("history_action"), 64)
        if history_action not in {"continue", "close_from_history", "needs_input"}:
            raise ValueError("plan.history_action must be continue|close_from_history|needs_input")
        normalized["history_action"] = history_action
        normalized["plan"] = _normalize_body_field("plan.plan", payload.get("plan"), PHASE_BODY_LIMIT, warnings=normalization_warnings)
        normalized["_normalization_warnings"] = normalization_warnings
        return normalized
    if phase == "execute":
        normalized["report"] = _normalize_body_field("execute.report", payload.get("report"), PHASE_BODY_LIMIT, warnings=normalization_warnings)
        normalized["official_validation_receipt"] = _normalize_flexible_field(
            "execute.official_validation_receipt",
            payload.get("official_validation_receipt"),
            scalar_limit=COMMAND_ITEM_LIMIT,
            item_limit=COMMAND_ITEM_LIMIT,
            warnings=normalization_warnings,
        )
        normalized["_normalization_warnings"] = normalization_warnings
        return normalized
    if phase == "validate":
        preexisting_warnings = _existing_normalization_warnings(payload)
        if not isinstance(payload.get("passed"), bool):
            raise ValueError("validate.passed must be a boolean")
        normalized["metric_name"] = _require_short_text(
            "validate.metric_name",
            payload.get("metric_name"),
            METRIC_NAME_LIMIT,
        )
        normalized["checks"] = _require_check_list(
            "validate.checks",
            payload.get("checks"),
            limit=LIST_SHORT_ITEM_LIMIT,
            warnings=normalization_warnings,
        )
        if validate_schema and validate_schema.get("type") == "object":
            required_fields = validate_schema.get("required")
            if isinstance(required_fields, list):
                missing_schema_fields = [field for field in required_fields if field not in normalized]
                if missing_schema_fields:
                    raise ValueError(
                        "validate output missing schema-required fields: "
                        + ", ".join(str(field) for field in missing_schema_fields)
                    )
        normalized["_normalization_warnings"] = [*preexisting_warnings, *normalization_warnings]
        return normalized
    if phase == "reflect":
        outcome = _normalize_reflect_outcome(payload.get("outcome"), normalization_warnings)
        if outcome not in {"passed", "failed"}:
            raise ValueError("reflect.outcome must be passed|failed")
        payload = dict(payload)
        payload["outcome"] = outcome
        normalized["outcome"] = outcome
        normalized["review"] = _normalize_body_field("reflect.review", payload.get("review"), PHASE_BODY_LIMIT, warnings=normalization_warnings)
        if outcome == "failed":
            if "corrective_prompt" not in payload:
                raise ValueError("reflect output missing required failure field: corrective_prompt")
            normalized["corrective_prompt"] = _normalize_text_field(
                "reflect.corrective_prompt",
                payload.get("corrective_prompt"),
                CORRECTIVE_PROMPT_LIMIT,
                warnings=normalization_warnings,
            )
            retry_authorized = payload.get("retry_authorized")
            if not isinstance(retry_authorized, bool):
                raise ValueError("reflect.retry_authorized must be a boolean")
            normalized["retry_authorized"] = retry_authorized
        normalized["_normalization_warnings"] = normalization_warnings
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
