"""Read-only GPU snapshot support."""

from __future__ import annotations

from typing import Any


def snapshot_gpu(*, disabled: bool = False) -> dict[str, Any]:
    if disabled:
        return {"schema_version": 1, "kind": "gpu", "available": False, "reason": "disabled", "gpus": []}
    try:
        import pynvml  # type: ignore
    except Exception as exc:
        return {
            "schema_version": 1,
            "kind": "gpu",
            "available": False,
            "reason": f"nvml_unavailable: {type(exc).__name__}",
            "gpus": [],
        }
    try:
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        rows: list[dict[str, Any]] = []
        for index in range(count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(index)
            memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")
            rows.append(
                {
                    "index": index,
                    "name": str(name),
                    "utilization_pct": int(getattr(util, "gpu", 0)),
                    "memory_used_mb": round(float(memory.used) / 1024 / 1024, 1),
                    "memory_total_mb": round(float(memory.total) / 1024 / 1024, 1),
                }
            )
        return {"schema_version": 1, "kind": "gpu", "available": True, "reason": None, "gpus": rows}
    except Exception as exc:
        return {
            "schema_version": 1,
            "kind": "gpu",
            "available": False,
            "reason": f"nvml_error: {type(exc).__name__}: {exc}",
            "gpus": [],
        }

