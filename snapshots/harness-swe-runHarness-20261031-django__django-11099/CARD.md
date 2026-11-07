# runHarness SWE — django__django-11099

- Outcome: **not-resolved**
- Detail: swebench report not resolved
- Driver: `@spockify/harness` `runHarness` via `lab-kernel-stdio` (not mini-SWE)
- Harness version: `0.1.0`
- Model: `gpt-oss-20b`
- Model digest (sha256/16 of /v1/models row): `e6c93479b976c181`
- Workers: 1
- Max turns: 48
- Prompt dataset: `SWE-bench/SWE-bench_Lite` split `test`
- Eval dataset: `SWE-bench/SWE-bench_Lite` split `test`
- Host: spock
- Commit: `fa8ca40bdbe90c7ce1387b776bf9b68d510a7f4d`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261031-django__django-11099/events.jsonl`
- Wall s: 281
- Events: 3737
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

- Patch bytes: 1434
- Board: harness-n5-20261031 (N=5 Lite)
- Historical sqlfluff pass@1=0 unchanged.
