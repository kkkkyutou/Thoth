# Thoth Audit Contract

These rules govern validation and evidence collection.

## Evidence

- Do not claim a phase is complete without real measured evidence.
- `criteria.current` must be populated before a completed phase is accepted.
- Every non-null verdict must reference real files in `evidence_paths`.

## Verification Gate

Before treating a strict task as execution-ready or resolved:

```bash
python -m thoth.cli doctor --quick
python -m thoth.cli init --sync
```

Only proceed on `PASS`, and only if the canonical `.thoth/objects` work/result ledger stays consistent.

## State Updates

When planning or execution state changes, update all required persistence surfaces together:

1. Canonical `.thoth/objects/decision`, `.thoth/objects/work_item`, `.thoth/objects/run`, `.thoth/objects/phase_result`, and `.thoth/objects/artifact`
2. `.agent-os/run-log.md`
3. Generated projections refreshed through `python -m thoth.cli init --sync`
