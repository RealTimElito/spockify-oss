# runHarness SWE — django__django-13401

- Outcome: **not-resolved** (nonempty via continues)
- Model: `gpt-oss-20b` · Think: high · Host: spock
- Commit: `a8007a2c`
- `swe_test_patch` **applied=true**
- Path: empty → empty-continue → no-edit → nonempty 2172 B → smoke fail → smoke-continue (no edit) → no-edit → final 2328 B; smoke still fail
- `diff_meta`: pass1=2172 final=2328 `continue_used=true`
- Patch: `django/db/models/fields/__init__.py` (`__eq__` identity / drop `@total_ordering`) — incomplete vs FAIL_TO_PASS abstract-field equality
- Eval **not-resolved**. Wall ~853s · Events ~16991
- Fail kept. No unique bump. No B-05. No thrash re-run.
