"""
trigger_runner.py — Async subprocess wrappers for validation scripts.
"""

import asyncio
import logging
from pathlib import Path

from thoth.observe.actions import record_action_receipt

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]


async def _run(cmd: list[str], timeout: int = 60) -> dict:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(PROJECT_ROOT),
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "returncode": proc.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
        }
    except asyncio.TimeoutError:
        proc.kill()
        return {"returncode": -1, "stdout": "", "stderr": "Timeout"}
    except Exception as exc:
        return {"returncode": -1, "stdout": "", "stderr": str(exc)}


async def run_validate() -> dict:
    result = await _run(["python", "-m", "thoth.cli", "doctor", "--json"])
    output = result["stdout"] or result["stderr"]
    passed = 1 if result["returncode"] == 0 else 0
    failed = 0 if result["returncode"] == 0 else 1
    payload = {
        "passed": passed,
        "failed": failed,
        "output": output,
        "returncode": result["returncode"],
    }
    payload["receipt"] = record_action_receipt(
        PROJECT_ROOT,
        action="dashboard.validate",
        status="ok" if result["returncode"] == 0 else "failed",
        summary="Dashboard validate action completed.",
        request={"command": ["python", "-m", "thoth.cli", "doctor", "--json"]},
        result=payload,
    )
    return payload


async def run_sync() -> dict:
    result = await _run(["python", "-m", "thoth.cli", "init", "--sync"])
    payload = {
        "output": result["stdout"],
        "returncode": result["returncode"],
    }
    payload["receipt"] = record_action_receipt(
        PROJECT_ROOT,
        action="dashboard.sync",
        status="ok" if result["returncode"] == 0 else "failed",
        summary="Dashboard sync action completed.",
        request={"command": ["python", "-m", "thoth.cli", "init", "--sync"]},
        result=payload,
    )
    return payload


async def run_verify(work_id: str) -> dict:
    result = await _run(["python", "-m", "thoth.cli", "status", "--json"])
    payload = {
        "passed": result["returncode"] == 0 and work_id in result["stdout"],
        "output": result["stdout"] or result["stderr"],
        "returncode": result["returncode"],
    }
    payload["receipt"] = record_action_receipt(
        PROJECT_ROOT,
        action="dashboard.verify",
        status="ok" if payload["passed"] else "failed",
        summary=f"Dashboard verify action completed for {work_id}.",
        request={"work_id": work_id, "command": ["python", "-m", "thoth.cli", "status", "--json"]},
        result=payload,
    )
    return payload


async def run_health_check() -> dict:
    validate_all = PROJECT_ROOT / "scripts" / "validate-all.sh"
    if not validate_all.exists():
        payload = {"returncode": -1, "output": "validate-all.sh not found"}
        payload["receipt"] = record_action_receipt(
            PROJECT_ROOT,
            action="dashboard.health-check",
            status="failed",
            summary="validate-all.sh not found.",
            result=payload,
        )
        return payload
    result = await _run(["bash", str(validate_all)], timeout=30)
    payload = {
        "output": result["stdout"],
        "returncode": result["returncode"],
    }
    payload["receipt"] = record_action_receipt(
        PROJECT_ROOT,
        action="dashboard.health-check",
        status="ok" if result["returncode"] == 0 else "failed",
        summary="Dashboard health-check action completed.",
        request={"command": ["bash", str(validate_all)]},
        result=payload,
    )
    return payload
