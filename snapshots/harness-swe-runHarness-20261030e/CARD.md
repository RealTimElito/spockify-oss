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
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261030e/events.jsonl`
- Wall s: 231
- Events: 1517
- Scored path: default `spockify bench swe --driver harness`.
- N=1 freeze instance — not a Lite board pass@1 %.
- Historical Lite pass@1=0 row is unchanged.
- May use one FAIL_TO_PASS local-smoke continue (no gold patch).

## Postmortem (not a resolve)

- Empty `model_patch`: agent called `run_tests` ×44 and **never** `apply_patch`.
- Smoke skipped: `pkg_resources` missing (setuptools) despite oyaml venv — fixed in driver for `20261030f`.
- Hypothesis for f: setuptools + require apply_patch before retest. If f still fails → stop sqlfluff-1625 loops; move to other instance / N>1 harness board.
- Historical pass@1=0 unchanged.
