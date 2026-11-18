# runHarness SWE — django__django-13448

- Outcome: **not-resolved** (nonempty via continues)
- Model: `gpt-oss-20b` · Think: high · Host: spock
- Commit: `bbfd5060`
- `swe_test_patch` applied=true
- Path: empty → empty-continue → nonempty 2954 B → smoke fail → smoke-continue (edits; 1661 B); smoke still fail
- `diff_meta`: pass1=2954 final=1661 `continue_used=true`
- Patch: `django/db/backends/base/creation.py` — incomplete vs FAIL_TO_PASS migrate_test_setting
- Eval **not-resolved**. Fail kept. No unique bump. No B-05.
