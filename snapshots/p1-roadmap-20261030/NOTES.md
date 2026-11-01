# Priority-1 — unique **12/27**; High 13551 resolve; B-05 1/9

## B-05 same-model cells (match **1/9**)

| Instance | Harness | OpenCode |
|----------|---------|----------|
| django-10914 | resolved | resolved |
| astropy-12907 | resolved | empty |
| django-11133 | later resolve; OC earlier empty | empty |
| django-11422 | resolved | nonempty not-resolved |
| django-11848 | resolved | empty |
| django-11999 | resolved | empty |
| django-12700 | resolved | nonempty not-resolved |
| django-12915 | resolved | empty |
| django-13447 | resolved | empty |
| django-13551 | resolved | empty |

## B-04

- Unique **12/27** (10914, 12907, 11039, 11133, 11422, 11848, 11999, 12453, 12700, 12915, 13447, **13551**).
- Fail rows kept (thrash ban: sqlfluff-1625, 12284–12708/12747, 12983, 13028, 13033, 13158, 13220, 13230, 13265, **13315**, **13321**, **13401**, **13448**, **13590**, **13658**, prior empties).
- Empty streak → `1585dd81`. Wrong-file/smoke → `f9ce8a0f`. No-edit gate → `f49bc7d4`. Strip fix → `8e7690d8`.

## High 13315 probe + diagnosis

- `swe_test_patch` applied=false (`corrupt patch at line 104`); FAIL_TO_PASS method absent.
- Empty-continue: glob/read/grep only; `test_limit_choices_to_no_duplicates` → no matches; `run_tests` blocked until edit; 0 apply_patch.
- Smoke AttributeError missing test; smoke-continue/no-edit skipped (empty diff).
- **Root cause (reproduced):** `_apply_test_patch` did `test_patch.strip()`, deleting trailing blank context line (`" \n"`). Raw patch applies; stripped → exact card error.
- Empty-continue 0 edits was largely a consequence of missing F2P, not inject weakness alone.
- Secondary: `_smoke_executed_failure` matched `Ran 1`+`FAILED` before missing-test skip.

### Fix (`8e7690d8`)

- Do not `.strip()` patch body; git apply via basename under `cwd=work`.
- Nonempty unapplicable test_patch → infra-skip (not model empty).
- Missing-only F2P (`_FailedTest` / `has no attribute 'test_'` without AssertionError) → smoke infra skip.
- After empty-continue still empty + 0 edits → `swe_no_edit_continue`.
- Unit tests for trailing context + missing-test smoke.

## High 13321 probe (post-fix)

- Next unused queue id; `swe_test_patch.applied=true` (fix verified).
- Nonempty 1678 B on `django/contrib/sessions/backends/base.py` (`_hash`); no empty-continue.
- Eval **not-resolved**. Fail kept. No re-run.
- Smoke this run returned `ok=null` because Lite F2P includes docstring titles that become `_FailedTest` even when AssertionErrors exist — over-broad skip blocked smoke-continue. Tightened to require no AssertionError before missing-F2P infra skip (unit test added). Do not re-run 13321 for that.

## High 13401 probe

- Next unused after 13321; test_patch applied.
- Empty pass1 → empty/no-edit continues → nonempty Field `__eq__` (2328 B); smoke fail; eval **not-resolved**.
- Fail kept. No driver churn. Continue batch → 13447.

## High 13447 resolve

- Next after 13401 fail; test_patch applied; smoke ok; nonempty 1258 B on `admin/sites.py`.
- Official eval **resolved**. Unique **10→11/27**. B-05 OpenCode next. Continue High **13448**.

## B-05 13447

- OpenCode empty_patch; harness had resolved. Match **1/8**.

## High 13448 probe

- test_patch applied; empty→continue→nonempty `creation.py` (1661 B); smoke fail; eval **not-resolved**.
- Fail kept. Batch complete. Next **13551**.

## High 13551 resolve

- Next unused after 13448; test_patch applied; pass1 nonempty 1194 B on `auth/tokens.py` (no continue).
- Smoke ok=None (docstring F2P title → `_FailedTest` ImportError); official eval **resolved**.
- Unique **11→12/27**. B-05 OpenCode next. Continue High **13590**, **13658**.

## B-05 13551

- OpenCode empty_patch; harness had resolved. Match **1/9**.

## High 13590 probe

- Next after 13551; empty pass1 → empty-continue → no-edit-continue; still 0 B.
- Eval **empty_patch** / not-resolved. Fail kept. No re-run. Continue → **13658**.

## High 13658 probe

- Next after 13590; empty pass1 → empty+no-edit continues; still 0 B; eval empty.
- Fail kept. **Consecutive High empties (13590, 13658)** → stop freeze chain; next unused **13660** after diagnose, not blind re-queue.
