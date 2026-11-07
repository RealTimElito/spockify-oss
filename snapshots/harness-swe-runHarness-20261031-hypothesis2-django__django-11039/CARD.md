# runHarness SWE — django__django-11039

- Outcome: **resolved**
- Detail: swebench report resolved
- Driver: `@spockify/harness` `runHarness` via `lab-kernel-stdio` (not mini-SWE)
- Harness version: `0.1.0`
- Model: `gpt-oss-20b`
- Model digest (sha256/16 of /v1/models row): `e6c93479b976c181`
- Workers: 1
- Max turns: 48
- Prompt dataset: `SWE-bench/SWE-bench_Lite` split `test`
- Eval dataset: `SWE-bench/SWE-bench_Lite` split `test`
- Host: spock
- Commit: `78d0547c8b8dab3c88a492165f11c23a3757f614`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261031-hypothesis2-django__django-11039/events.jsonl`
- Wall s: 411
- Events: 2532
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

## Fix context

- Post empty-patch reliability: `run_tests` blocked until successful write.
- Prior N=5 card for this id remains **not-resolved** (fail row kept).
- Historical sqlfluff pass@1=0 unchanged.
