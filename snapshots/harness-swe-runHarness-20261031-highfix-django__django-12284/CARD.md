# runHarness SWE — django__django-12284 (highfix)

- Outcome: **not-resolved** (empty_patch)
- Detail: swebench empty patch; official incomplete
- Driver: `@spockify/harness` `runHarness` via `lab-kernel-stdio`
- Model: `gpt-oss-20b` · Think: high
- Host: spock
- Commit (probe): `0093a535e00abd180f64bd1b142bbe0264246238`
- Traces: `/workspace/spockify/bench-out/harness-swe-runHarness-20261031-highfix-django__django-12284/events.jsonl`
- Wall s: 843 · Events: 17870
- `diff_meta`: pass1=0 final=0 `continue_used=true` (`swe_empty_patch_continue`; smoke-continue skipped — empty diff)
- Writes: 0 ok apply_patch (4 fails: noop SEARCH/REPLACE + SEARCH not found); 24 test blocks; **0** `_noop` stub rejects
- Hypothesis (`_noop` reject → real fields edit): **not confirmed** — model never tried stub; never landed tracked edit
- Prior nonempty fail row **kept**: `snapshots/harness-swe-runHarness-20261031-high-django__django-12284/`
- Unique B-04 **unchanged** this probe (no resolve). N=1 ≠ board %
