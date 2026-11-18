# runHarness SWE — django__django-11583

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
- Commit: `a8e2031ddb38b5e0a2004ca0e471986d4673ac52`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261031-high-django__django-11583/events.jsonl`
- Wall s: 362
- Events: 5723
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

## Fix context

- High-think new Lite id (`SPOCKIFY_HARNESS_THINKING=high`).
- Empty final patch / 0 ok writes — fail row kept; unique 3/26.
