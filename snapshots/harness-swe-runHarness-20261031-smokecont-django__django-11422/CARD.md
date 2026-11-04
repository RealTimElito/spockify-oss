# runHarness SWE — django__django-11422

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
- Commit: `dd07974932d1e8ead1ee327a86ae66a0c76410f9`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261031-smokecont-django__django-11422/events.jsonl`
- Wall s: 345
- Events: 2031
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

## Fix context

- Smoke-continue probe (pytest in smoke venv; unittest FAIL_TO_PASS → -k on smokecont2).
- Smoke-continue did not fire; prior N=5c fail kept; unique unchanged 4/27.
