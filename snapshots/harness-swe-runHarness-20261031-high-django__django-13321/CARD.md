# runHarness SWE — django__django-13321

- Outcome: **not-resolved** (nonempty)
- Model: `gpt-oss-20b` · Think: high · Host: spock
- Commit: `8e7690d8` / stamp `077bd2df` (test_patch strip fix)
- `swe_test_patch` **applied=true** (strip fix verified)
- `diff_meta`: pass1=1678 final=1678 `continue_used=false`
- Patch: `django/contrib/sessions/backends/base.py` (_hash) — wrong/incomplete vs FAIL_TO_PASS
- Smoke: local FAIL_TO_PASS ran (355 tests, failures+errors); this run's smoke `ok` was wrongly null because Lite F2P docstring titles become `_FailedTest` (tightened in follow-up; do not re-run 13321)
- Smoke-continue not fired on this run; eval **not-resolved**
- Wall ~316s · Events ~3251
- Fail kept. No unique bump. No B-05. No thrash re-run.
