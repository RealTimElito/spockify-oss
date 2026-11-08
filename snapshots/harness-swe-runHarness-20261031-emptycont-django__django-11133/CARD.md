# runHarness SWE — django__django-11133

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
- Commit: `d35c1a3b033d6bd5e111e6dda4a77e0a6a06d3a4`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261031-emptycont-django__django-11133/events.jsonl`
- Wall s: 421
- Events: 6641
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

## Fix context

- Empty-diff continue probe on prior N=5d nonempty-fail (High think).
- **Resolved**, but `continue_used=false` — empty-diff continue did not fire (nonempty pass1); smoke skipped (no pytest).
- Prior N=5d not-resolved fail row kept. Unique → 4/27.
