# runHarness SWE — sqlfluff__sqlfluff-1625

- Outcome: **not-resolved**
- Detail: swebench report not resolved
- Driver: `@spockify/harness` `runHarness` via `lab-kernel-stdio` (not mini-SWE)
- Harness version: `0.1.0`
- Model: `gpt-oss-20b`
- Model digest (sha256/16 of /v1/models row): `e6c93479b976c181`
- Workers: 1
- Max turns: 48
- Prompt dataset: `princeton-nlp/SWE-bench` split `dev`
- Eval dataset: `SWE-bench/SWE-bench` split `dev`
- Host: spock
- Commit: `3d994e10216efc996628b735260cc77b4417df48`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261030f/events.jsonl`
- Wall s: 813
- Events: 13452
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

## Postmortem

- Nonempty wrong L031 (skip-alias heuristic); gold is a one-line description string change.
- Smoke returned fail (continue used); click/CliRunner pin added after this run for fairer smoke.
- **Do not re-run sqlfluff-1625 overnight without a new harness hypothesis.** Next: other instance via `SPOCKIFY_HARNESS_SWE_INSTANCE`.
- Historical pass@1=0 unchanged.
