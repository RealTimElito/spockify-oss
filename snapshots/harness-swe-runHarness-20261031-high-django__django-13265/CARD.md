# runHarness SWE — django__django-13265

- Outcome: **not-resolved** (nonempty wrong-file patch)
- Model: `gpt-oss-20b` · Think: high · Host: spock
- Commit: `f9ce8a0f` (smoke-continue apply_patch + traceback source)
- `diff_meta`: pass1 387 B → final 387 B · continue_used=True
- Patch only touched `django/__init__.py` (unrelated get_version import); migrations FAIL_TO_PASS still failing
- Smoke-continue: 0 apply_patch (read/search only) despite must-edit prompt — diff unchanged
- Unique B-04 unchanged **10/27**. Fail kept. N=1 ≠ board %
