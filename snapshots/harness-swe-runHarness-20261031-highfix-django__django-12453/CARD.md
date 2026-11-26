# runHarness SWE — django__django-12453

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
- Commit: `ad06744c89ee86dab15c2de4262ccadd6f371ade`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261031-highfix-django__django-12453/events.jsonl`
- Wall s: 677
- Events: 3053
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

- Unique B-04: **7/27 → 8/27** (+12453). Prior fail kept.
