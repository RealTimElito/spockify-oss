# runHarness SWE — sqlfluff__sqlfluff-1625

- Outcome: **not-resolved**
- Detail: swebench report `unresolved_ids` (not `empty_patch_ids`). One `apply_patch` with path `src/sqlfluff/rules/L031.py` wrote a 6-line diff; the official grade did not resolve the instance. Not a pass@1.
- Driver: `@spockify/harness` `runHarness` via `lab-kernel-stdio` (not mini-SWE)
- Harness id: `spockify`
- Model: `gpt-oss-20b`
- Workers: 1
- Max turns: 48
- Dataset: `princeton-nlp/SWE-bench` split `dev` (prompt and clone). Grade: `SWE-bench/SWE-bench` split `dev`, same instance, because swebench 5.0.2 requires an `image` field the princeton-nlp row does not have. Report: `bench-out/harness-swe-runHarness-20260920/eval/gpt-oss-20b.harness-runHarness-20260920.json`
- Host: spock
- Commit: `1379a8c`
- Wall s: 2121 (model loop). Grade follow-up: 49s. `empty_patch_ids` empty. `infra_failure_ids` empty.
- Events: 191
- No-path `apply_patch`: yes, 20 tool results with `ok: false` and `error: "path required"`. Those calls did not dirty the tree. A later call included a path, so the workspace was not left empty.
- Phase 5 stays Partial (one instance is not the default scored driver).
- Historical Lite pass@1=0 row is unchanged.
