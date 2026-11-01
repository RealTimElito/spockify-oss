# runHarness SWE — django__django-13315

- Outcome: **not-resolved** (empty)
- Model: `gpt-oss-20b` · Think: high · Host: spock
- Commit: `f49bc7d4` (no-edit continue gate)
- `diff_meta`: pass1=0 final=0 `continue_used=true` (`swe_empty_patch_continue`)
- `swe_test_patch` **applied=false** (corrupt patch at line 104) → FAIL_TO_PASS method missing in tree
- Empty-continue: 0 `apply_patch` (read/grep/`run_tests` only); still empty
- Smoke: FAIL AttributeError missing `test_limit_choices_to_no_duplicates` (no test_patch)
- Smoke-continue / no-edit gate **not fired** (require nonempty diff)
- Wall ~295s · Events ~4698
- Fail kept. No unique bump. No B-05.
