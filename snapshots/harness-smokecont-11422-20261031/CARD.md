# Smoke-continue probe — django__django-11422

- Hypothesis: install pytest (+ unittest FAIL_TO_PASS parse) so local-smoke continue can fire on a prior nonempty-fail.
- Model: `gpt-oss-20b` · Think: `high` · Lite · Spark PF `:24001`
- Code: `_ensure_smoke_venv` now `pip install pytest`; `_smoke_fail_to_pass` parses `test_x (mod.Class)` → `-k test_x`

## Scores

| Run | Outcome | Patch | Smoke | Continue |
|-----|---------|-------|-------|----------|
| Prior N=5c | not-resolved | nonempty 592 B | skip (no pytest) | none |
| smokecont1 (pytest only) | **not-resolved** | nonempty 319 B | skip: unittest name as path | `continue_used=false` |
| smokecont2 (+ `-k` parse) | **not-resolved** | **empty** | skip: Django ImproperlyConfigured / 238 collection errors | empty-diff continue **yes**; smoke-continue **no** |

## Did smoke-continue fire?

**No.** After pytest install + name parse, smoke still returns `ok=null` (collection infra), so the smoke-continue branch (`smoke_ok is False` ∧ nonempty patch) never runs. smokecont2 only hit empty-diff continue because pass1 was empty.

- Prior N=5c fail row **kept**. Unique B-04 stays **4/27**.
- Residual: Django FAIL_TO_PASS needs settings/test runner — pytest `-k` alone is not enough.

Runs: `20261031-smokecont-django__django-11422`, `20261031-smokecont2-django__django-11422`

- Evidence commit: `d4cde0f8`
