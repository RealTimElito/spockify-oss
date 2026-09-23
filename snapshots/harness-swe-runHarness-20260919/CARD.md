# runHarness SWE — sqlfluff__sqlfluff-1625

- Outcome: **not-resolved**
- Detail: agent finished (17 model turns) but git diff was empty; swebench `empty_patch_ids` (apply_patch called without a path). Not an infra failure.
- Driver: `@spockify/harness` `runHarness` via `lab-kernel-stdio` (not mini-SWE)
- Model: `gpt-oss-20b`
- Workers: 1
- Max turns: 48
- Host: spock
- Wall s: 488
- Events: 68
- Eval: `bench-out/harness-swe-runHarness-20260919/eval/gpt-oss-20b.harness-runHarness.json`
- Phase 5 stays Partial (one instance is not the default scored driver).
- Historical Lite pass@1=0 row is unchanged.
