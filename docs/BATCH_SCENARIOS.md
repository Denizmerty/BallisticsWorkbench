# Batch scenarios

`npm run batch:run` executes a bounded list of normal calculation requests against the native
engine. It is intended for validation matrices, sensitivity studies, and load development. Each
request can contain the six built-in loads and up to three custom loads, so a scenario can compare
several loads without starting one engine process per load.

The input uses `protocol/ballistics-batch.schema.json`:

```json
{
    "schemaVersion": 1,
    "scenarios": [
        {
            "id": "baseline",
            "request": {
                "protocolVersion": 2,
                "requestId": "batch-baseline",
                "scenario": {},
                "customLoads": []
            }
        }
    ]
}
```

The abbreviated `scenario` above is illustrative. Every embedded request must satisfy the complete
calculation contract in `protocol/ballistics-protocol.schema.json`. The native parser remains the
authority for semantic and cross-field validation.

Run a batch with:

```text
npm run batch:run -- --input scenarios.json --engine build/stage/bin/ballistics_cli --output report.json
```

On Windows, use `build/stage/bin/ballistics_cli.exe`. The runner permits 1–128 scenarios, rejects
duplicate IDs, limits input to 8 MiB and each response to 32 MiB, applies a configurable timeout,
and uses at most eight concurrent native processes. `--fail-fast` stops scheduling new work after a
failure. The report retains every native result and calculates endpoint deltas from the first
successful scenario for velocity, energy, time, drop, sight path, and wind drift.
