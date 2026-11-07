# Priority-1 — unique **27/27**; B-05 **6/27**; Lite **70/300** Partial parked

## B-05 same-model cells (match **3/16**)

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
| django-13660 | resolved | nonempty not-resolved |
| django-14855 | resolved | resolved |

## B-04

- Unique **13/27** (10914, 12907, 11039, 11133, 11422, 11848, 11999, 12453, 12700, 12915, 13447, 13551, **13660**).
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
- Fail kept. **Consecutive High empties (13590, 13658)** → brief diagnose then advance (not blind re-queue).

## Empty-chain diagnose (13590+13658)

- Continues + no-edit gates fired as designed; not a missing-inject bug.
- 13590: 0 edit attempts (grep/read/run_tests only).
- 13658: 2 `apply_patch` attempts, both failed → still 0 B.
- Prefer progress over driver churn with no clear new bug → High **13660**.

## High 13660 resolve

- Next unused after empty-chain diagnose; test_patch applied; pass1 nonempty 1655 B on `django/core/management/commands/shell.py` (no continue).
- Smoke ok; official eval **resolved**. Unique **12→13/27**.
- B-05 OpenCode next. Continue High **13710**.

## B-05 13660

- OpenCode nonempty 652 B not-resolved; harness had resolved. Match **1/10**.

## High 13710 probe

- Next after 13660 resolve; empty pass1 → empty+no-edit continues; still 0 B; eval empty.
- Fail kept. No re-run. B-05 **13660** + High **13757** next.

## B-05 13660

- OpenCode not-resolved (nonempty patch ~652 B; eval miss). Harness had resolved. Match **1/10**.

## High 13710 probe

- Empty pass1 → empty+no-edit continues; still 0 B; eval empty.
- Fail kept. No re-run. Continue → **13757**.

## High 13757 probe

- Empty after continues; eval empty. Fail kept.
- **Consecutive High empties (13710, 13757)** → stop freeze chain; next unused **13768** after brief diagnose, not blind re-queue.

## Empty-chain note (13710+13757)

- Continues + no-edit gates fired; same pattern as 13590/13658 — not a missing-inject bug.
- Prefer advance → High **13768**.

## High 13768 resolve

- Next unused after empty-chain note; test_patch applied; pass1 nonempty 1250 B on `django/dispatch/dispatcher.py` (no continue).
- Smoke ok; official eval **resolved**. Unique **13→14/27**.
- B-05 OpenCode next. Continue High **13925**.

## B-05 13768

- OpenCode empty_patch; harness had resolved. Match stays **1/10**.
- Continue High **13925**.

## High 13925 probe

- Next after 13768; pass1 nonempty ~44k B; smoke fail; smoke/no-edit continues no further edits; eval **not-resolved**.
- Fail kept. No re-run. Next High **13933**.

## High 13933 probe

- Next after 13925; empty pass1; empty+no-edit continues; eval empty. Fail kept.
- No re-run. Next High **13964** (not consecutive-empty stop — 13925 was nonempty).

## High 13964 probe

- Next after 13933; empty continue → nonempty ~969 B; smoke fail; no-edit continue grew to ~1823 B; local smoke ok; official eval **patch-apply failed** (`tests/many_to_one/models.py` hunk).
- Fail kept (error_ids). No B-05. No re-run. Next High **14016**.

## High 14016 resolve

- Next after 13964; pass1 nonempty 913 B; smoke ok; no continue; official eval **resolved**. Unique **14→15/27**.
- B-05 OpenCode next. Continue High **14017**.

## B-05 14016

- OpenCode empty_patch; harness had resolved. Match **1/11**.
- Continue High **14017**.

## High 14017 probe

- Next after 14016; empty pass1; empty+no-edit continues; smoke fail; eval empty. Fail kept.
- No B-05. No re-run. Next High **14155** (+optional 14238).

## High 14155 probe

- Next after 14017; empty pass1; empty+no-edit continues; smoke fail; eval empty. Fail kept.
- No B-05. No re-run. Live High **14238**.

## High 14238 probe

- Next after 14155; empty pass1; empty+no-edit continues (0 edit_starts); smoke fail; eval empty. Fail kept.
- No B-05. No re-run. Third consecutive High empty → pause freezes; next unused **14382**.

## Empty-chain diagnose (14017/14155/14238)

- Continues fired on all three (`swe_empty_patch_continue` → `swe_no_edit_continue` → `swe_empty_after_no_edit_continue`).
- 14017/14155: one `apply_patch` each rejected as noop identical SEARCH/REPLACE; 14238: 0 edits.
- **Verdict: model-empty — no new driver bug; advance.**

## High 14382 resolve

- Next after empty-chain pause; pass1 nonempty 1197 B; smoke ok; no continue; official eval **resolved**. Unique **15→16/27**.
- B-05 OpenCode **resolved** (~708 B). Match **1→2/12**. Continue High **14411**.

## High 14411 probe

- Next after 14382; nonempty 427 B wrong-file comment stub on `django/__init__.py`; smoke fail; eval miss. Fail kept.
- No B-05. No re-run. Next High **14534**.

## High 14534 resolve

- Next after 14411; pass1 nonempty 1195 B; no continue; official eval **resolved**. Unique **16→17/27**.
- B-05 OpenCode empty_patch; harness had resolved. Match **2/13**. Next High **14580**.

## High 14580 resolve

- Next after 14534; pass1 552 B → continue path → final 1746 B; official eval **resolved**. Unique **17→18/27**.
- B-05 OpenCode nonempty miss (451 B wrong test migration). Match **2/14**. Continue High **14608**.

## High 14608 probe

- Next after 14580; nonempty 21002 B; no continue; smoke ok≠official. Fail kept.
- No B-05. No re-run. Next High **14667**.

## High 14667 probe

- Next after 14608; empty pass1; empty+no-edit continues (0 edits); eval empty. Fail kept.
- No B-05. No re-run. Next High **14672**.

## High 14672 probe

- Next after 14667; nonempty 9331 B; max turns exhausted; no continue; smoke ok=null; eval miss. Fail kept.
- No B-05. No re-run. Next High **14730**.

## High 14730 probe

- Next after 14672; empty pass1; empty+no-edit continues (0 edits); smoke fail; eval empty. Fail kept.
- No B-05. No re-run. Next High **14752**.

## High 14752 resolve

- Next after 14730; pass1 1881 B → smoke fail → continue → final 3429 B; smoke-after-continue ok; official eval **resolved**. Unique **18→19/27**.
- B-05 OpenCode empty_patch; harness had resolved. Match **2/15**. Continue High **14787**.

## High 14787 probe

- Next after 14752; test_patch applied; pass1 nonempty 2131 B on `django/utils/decorators.py`; no continue; smoke ok=null; eval **not-resolved**.
- Fail kept. No B-05. No re-run. Next High **14855**.

## High 14855 resolve

- Next after 14787; first attempt infra `fetch failed` (LiteLLM tunnel/key) — discarded, not a fail row.
- Retry: pass1 nonempty 1059 B on `django/contrib/admin/helpers.py`; smoke ok; official eval **resolved**. Unique **19→20/27**.
- B-05 OpenCode **resolved** (630 B). Match **2/15 → 3/16**. Continue High **14915**.

## High 14915 probe

- Next after 14855; empty pass1; empty+no-edit continues; eval empty. Fail kept.
- No B-05. No re-run. Next High **14997**.

## High 14997 empty
- Empty pass1; empty+no-edit continues; eval empty_patch. Fail kept.
- No B-05. No re-run. Next High **14999**.

## High 14999 empty
- Empty pass1; empty+no-edit continues; eval empty_patch. Fail kept.
- No B-05. No re-run. Third consecutive High empty (14915/14997/14999) → pause freezes; next unused **15061** after brief diagnose.

## Empty-chain diagnose (14915/14997/14999)

- Continues path OK on all three: `swe_empty_patch_continue` → `swe_no_edit_continue` → `swe_empty_after_no_edit_continue`.
- `diff_meta`: pass1=0, final=0, continue_used=true. Model produced no production edit.
- **No clear driver bug** → advance to 15061 (not re-queue empties).

## High 15061 / 15202 / 15213

- All three: empty pass1; empty+no-edit continues; eval empty_patch. Fail kept.
- No B-05. Ban all three. Unique B-04 unchanged **20/27**. Next High **15252**.

## High 15252 probe

- Next after 15213; pass1 nonempty; continues; final 4558 B; eval **not-resolved**.
- Fail kept. No B-05. No re-run. Next High **15320**.

## High 15320 empty

- Empty pass1; empty+no-edit continues; eval empty_patch. Fail kept.
- No B-05. No re-run. Next High **15347**.

## High 15347 resolve

- Pass1 nonempty 1162 B; no continue; official eval **resolved**. Unique **20→21/27**.
- B-05 OpenCode next. Continue High **15388**.

## B-05 15347

- OpenCode outcome **resolved** (711 B). Match **4/17**.
- Continue High **15388**.

## High 15388 resolve

- Official eval **resolved**. Unique **21→22/27**.
- B-05 OpenCode next.

## B-05 15388

- OpenCode outcome **empty** (0 B). Match **4/18**.
- Continue High **15388**.

## High 15400 probe

- nonempty after continues=True; eval **not-resolved** (3891 B). Fail kept. No B-05. No re-run.


## High 15498 probe

- eval **not-resolved** (3305 B). Fail kept. No B-05. No re-run.

## High 15695 probe

- eval **not-resolved** (1029 B). Fail kept. No B-05. No re-run.

## High 15738 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.


## High 15781 resolve

- Official eval **resolved**. Unique bump.
- B-05 OpenCode next. Continue High queue.

## High 15789 resolve

- Official eval **resolved**. Unique bump.
- B-05 OpenCode next. Continue High queue.

## High 15790 resolve

- Official eval **resolved**. Unique bump.
- B-05 OpenCode next. Continue High queue.

## B-05 15781

- OpenCode outcome **empty**. Match **4/21**.

## B-05 15789

- OpenCode outcome **empty**. Match **4/21**.

## B-05 15790

- OpenCode outcome **nonempty fail**. Match **4/21**.


## High 15814 probe

- eval **not-resolved** (540 B). Fail kept. No B-05. No re-run.

## High 15819 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High 15851 resolve

- Official eval **resolved**. Unique bump.
- B-05 OpenCode next. Continue High queue.

## B-05 15851

- OpenCode outcome **empty**. Match **4/22**.


## High 15902 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High 15996 probe

- eval **not-resolved** (472 B). Fail kept. No B-05. No re-run.

## High 16041 resolve

- Official eval **resolved**. Unique bump.
- B-05 OpenCode next. Continue High queue.

## B-05 16041

- OpenCode outcome **empty**. Match **4/23**.

## B-04 unique denominator closed

- Unique High freezes **27/27** sealed by **16041**. Partial evidence for that row is **complete**.
- Cite **27/27** as the closed slice; optional post-slice High resolves noted separately — no new unique denominator.
- **B-05** and **Lite** remain open. Next High **16046** (+1–2) for B-05 opportunities only.


## High 16046 resolve (post-slice)

- Official eval **resolved**. Unique denom stays **27/27 closed**; noted separately.
- B-05 OpenCode next. Continue High queue.

## High 16139 probe

- eval **not-resolved** (9259 B). Fail kept. No B-05. No re-run.

## High 16229 probe

- eval **not-resolved** (943 B). Fail kept. No B-05. No re-run.

## B-05 16046

- OpenCode outcome **nonempty fail**. Match **4/24**.


## High 16255 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High 16379 resolve (post-slice)

- Official eval **resolved**. Unique denom stays **27/27 closed**; noted separately.
- B-05 OpenCode next. Continue High queue.

## High 16400 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## B-05 16379

- OpenCode outcome **resolved**. Match **5/25**.


## High 16408 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High 16527 resolve (post-slice)

- Official eval **resolved**. Unique denom stays **27/27 closed**; noted separately.
- B-05 OpenCode next. Continue High queue.

## High 16595 probe

- eval **not-resolved** (2511 B). Fail kept. No B-05. No re-run.

## B-05 16527

- OpenCode outcome **resolved**. Match **6/26**.


## High 16816 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High 16820 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High 16873 probe

- eval **not-resolved** (13995 B). Fail kept. No B-05. No re-run.


## High 16910 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High 17051 probe

- eval **not-resolved** (278 B). Fail kept. No B-05. No re-run.

## High 17087 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (post 17087)

- django Lite High ≥12908 exhausted at **17087**. Next Lite High candidate: **astropy-12907** (`astropy__astropy-12907`).


## High astropy-14182 probe

- eval **not-resolved** (1392 B). Fail kept. No B-05. No re-run.

## High matplotlib-18869 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-11400 probe

- eval **not-resolved** (1116 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: astropy-14182, matplotlib-18869, sympy-11400.


## High matplotlib-22711 probe

- eval **not-resolved** (4112 B). Fail kept. No B-05. No re-run.

## High sympy-11870 probe

- eval **not-resolved** (562 B). Fail kept. No B-05. No re-run.

## High astropy-14365 probe

- eval **not-resolved** (807 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-22711 batch)

- High batch: matplotlib-22711, sympy-11870, astropy-14365.
- Next: matplotlib-22835.


## High matplotlib-22835 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-11897 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High astropy-14995 probe

- eval **not-resolved** (1597 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-22835 batch)

- High batch: matplotlib-22835, sympy-11897, astropy-14995.
- Next: matplotlib-23299.


## High matplotlib-23299 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-12171 probe

- eval **not-resolved** (3435 B). Fail kept. No B-05. No re-run.

## High astropy-6938 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-23299 batch)

- High batch: matplotlib-23299, sympy-12171, astropy-6938.
- Next: matplotlib-23314.


## High matplotlib-23314 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-12236 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-12454 probe

- eval **not-resolved** (534 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-23314 batch)

- High batch: matplotlib-23314, sympy-12236, sympy-12454.
- Astropy Lite High exhausted; skipped.
- Next: matplotlib-23476.


## High matplotlib-23476 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-12419 probe

- eval **not-resolved** (454 B). Fail kept. No B-05. No re-run.

## High sympy-12481 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-23476 batch)

- High batch: matplotlib-23476, sympy-12419, sympy-12481.
- Astropy Lite High exhausted; skipped.
- Next: matplotlib-23562.


## High matplotlib-23562 probe

- eval **not-resolved** (321 B). Fail kept. No B-05. No re-run.

## High sympy-13031 probe

- eval **not-resolved** (770 B). Fail kept. No B-05. No re-run.

## High sympy-13043 probe

- eval **not-resolved** (570 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-23562 batch)

- High batch: matplotlib-23562, sympy-13031, sympy-13043.
- Astropy Lite High exhausted; skipped.
- Next: matplotlib-23563.


## High matplotlib-23563 probe

- eval **not-resolved** (242 B). Fail kept. No B-05. No re-run.

## High sympy-13146 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-13177 probe

- eval **not-resolved** (2093 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-23563 batch)

- High batch: matplotlib-23563, sympy-13146, sympy-13177.
- Astropy Lite High exhausted; skipped.
- Next: matplotlib-23913.


## High matplotlib-23913 probe

- eval **not-resolved** (251 B). Fail kept. No B-05. No re-run.

## High sympy-13437 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-13471 probe

- eval **not-resolved** (364 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-23913 batch)

- High batch: matplotlib-23913, sympy-13437, sympy-13471.
- Astropy Lite High exhausted; skipped.
- Next: matplotlib-23964.


## High matplotlib-23964 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-13480 probe

- eval **not-resolved** (558 B). Fail kept. No B-05. No re-run.

## High sympy-13647 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-23964 batch)

- High batch: matplotlib-23964, sympy-13480, sympy-13647.
- Astropy Lite High exhausted; skipped.
- Next: matplotlib-23987.

## Queue note (mpl-23987 batch)

- High batch: matplotlib-23987, sympy-13773, sympy-13895.
- Astropy Lite High exhausted; skipped.
- Next: matplotlib-24149.


## High matplotlib-23987 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-13773 probe

- eval **not-resolved** (3025 B). Fail kept. No B-05. No re-run.

## High sympy-13895 probe

- eval **not-resolved** (670 B). Fail kept. No B-05. No re-run.


## High matplotlib-24149 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-13915 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-13971 probe

- eval **not-resolved** (284 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-24149 batch)

- High batch: matplotlib-24149, sympy-13915, sympy-13971.
- Astropy Lite: skip 12907; 7746 deferred.
- Next: matplotlib-24265.


## High matplotlib-24265 probe

- eval **not-resolved** (3277 B). Fail kept. No B-05. No re-run.

## High sympy-14024 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-14308 probe

- eval **not-resolved** (318 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-24265 batch)

- High batch: matplotlib-24265, sympy-14024, sympy-14308.
- Astropy Lite: skip 12907; 7746 deferred.
- Next: matplotlib-24334.


## High matplotlib-24334 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-14317 probe

- eval **not-resolved** (1450 B). Fail kept. No B-05. No re-run.

## High sympy-14396 resolve (post-slice)

- Official eval **resolved**. Unique denom stays **27/27 closed**; noted separately.
- B-05 OpenCode next. Continue High queue.

## B-05 sympy-14396

- OpenCode outcome **nonempty fail**. Match **6/27**.

## Queue note (mpl-24334 batch)

- High batch: matplotlib-24334, sympy-14317, sympy-14396.
- Astropy Lite: skip 12907; 7746 deferred.
- Next: matplotlib-24970.


## High matplotlib-24970 probe

- eval **not-resolved** (532 B). Fail kept. No B-05. No re-run.

## High sympy-14774 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-14817 probe

- eval **not-resolved** (1166 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-24970 batch)

- High batch: matplotlib-24970, sympy-14774, sympy-14817.
- Astropy Lite: skip 12907; 7746 deferred.
- Next: matplotlib-25079.


## High matplotlib-25079 probe

- eval **not-resolved** (332 B). Fail kept. No B-05. No re-run.

## High sympy-15011 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-15308 probe

- eval **not-resolved** (291 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-25079 batch)

- High batch: matplotlib-25079, sympy-15011, sympy-15308.
- Astropy Lite: skip 12907; 7746 deferred.
- Next: matplotlib-25311.


## High matplotlib-25311 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-15345 probe

- eval **not-resolved** (463 B). Fail kept. No B-05. No re-run.

## High sympy-15346 probe

- eval **not-resolved** (1273 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-25311 batch)

- High batch: matplotlib-25311, sympy-15345, sympy-15346.
- Astropy Lite: skip 12907; 7746 deferred.
- Next: matplotlib-25332.
## B-05 gap fill 12453 / 11039

- B-05 django-12453: OpenCode **nonempty miss**. Match board **6/27**.
- B-05 django-11039: OpenCode **empty**. Match board **6/27**.
- High grind idle (mpl-25332 stopped). Unique 27/27 closed unchanged.

## Lite move-on honesty 2026-11-03

- No bounded eval batch left: Hub-429 retry done; 3 patch-apply residuals already micro-retried and still fail (malformed preds).
- Hub auth still none on Spock. Score stays **68/296** completed — not clean board %.
- Did not start multi-day full-board regen. Ranked leftovers in SUMMARY (1 pred-regen×3 → 2 Hub login → 3 accept Partial / park).
- No Terminal Bench. No High empties.



## High matplotlib-25332 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-15609 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-15678 probe

- eval **not-resolved** (1499 B). Fail kept. No B-05. No re-run.

## Queue note (mpl-25332 batch)

- High batch: matplotlib-25332, sympy-15609, sympy-15678.
- Astropy Lite: skip 12907; 7746 deferred.
- Next: matplotlib-25433.

## Lite pred-regen×3 (2026-11-03)

- Regenerated preds for `django__django-12113`, `django__django-12184`, `sphinx-doc__sphinx-8506` via harness/`runHarness` think=low on Spock (after High mpl-25332 batch idle).
- Batch eval: **2 resolved / 1 unresolved / 0 errors** (3/3 completed).
- Combined Lite board: **70/300** completed-denominator (was 68/296 + 3 patch-apply).
- Next Lite leftover: accept Partial **70/300** and park (or Hub login before any large regrade).

## Marketing / PRODUCTION_READINESS honesty (2026-11-03)

- Allowed public line only; G8 Red; no SWE board % / “beats OpenCode” / enterprise.
- Partial gates G0/G3–G7 restated without greenwash (G6: no verified 30-day window; G7 signing ≠ gate Green).
- Canvas Lite **68/296 → 70/300**; HARNESS Phase 5 line no longer claims “scored SWE still mini-SWE.”
- Hub auth skipped (no Tim creds). High parked. Next productive leftover: harness quality (sqlfluff / planning).

## Harness quality (sqlfluff / planning) — park until planning (2026-11-03)

### Diagnosis

- Re-read `docs/HARNESS.md`, freeze cards `snapshots/harness-swe-runHarness-20261030{,c,d,e,f}/`, LEAP-024 NOTES, and P1 empty-chain notes.
- **sqlfluff-1625:** not a missing smoke/venv gate anymore (e→f fixed setuptools/click; write-before-retest). Residual is **model/planning**: nonempty wrong L031 logic; gold is one-line description. Historical `pass@1=0` kept. Card f already bans re-run without new hypothesis.
- **LEAP-024 resolve ≠ harness quality:** gold description in prompt + normalize. Do not reintroduce.
- **Empty-chains:** continues/no-edit already fire; no open driver bug.
- **N=5×4 all 0/5:** stop blind N growth.
- **This turn:** no small fix with clear bug+test → **plan-only, no freezes.**

### What not to re-run

- sqlfluff-1625; thrash-ban list (top of this NOTES); High empties; N=5 boards; gold-prompt salvage; new Lite denom without post-fix resolve.

### Evidence that would unblock

1. ~~Offline taxonomy of nonempty-miss / empty-continue traces~~ **done** — `TAXONOMY.md` (Partial). Top-2: empty_after_continues **50** + nonempty_miss family **53** / 130 High rows. No systemic missing-continue.
2. Only then: driver/gate PR if a **new** trace shows a mechanical miss; unit test; probe one unused Lite id.
3. Planning steers (F2P-body-before-write / description-class without gold / wrong-file early stop 14411/13265) — taxonomy ranks nonempty_miss #2; optional.
4. New harness resolve → B-05 that id; then maybe Lite pred freshness.

SoT plan text: `SUMMARY.md` § Next · taxonomy: `TAXONOMY.md`.

## Offline trajectory taxonomy (2026-11-03)

- Wrote `snapshots/p1-roadmap-20261030/TAXONOMY.md` from existing High/B-05/Lite cards + SUMMARY/NOTES (no freezes).
- Scores SoT unchanged: B-04 **27/27** · B-05 **6/27** · Lite **70/300**.
- Verdict: Partial; no invented board %; no driver fix shipped this turn.

## Planning steer — F2P-body + wrong-file early stop (2026-11-04)

- Taxonomy implication: no mechanical gate bug; optional planning steers for nonempty_wrong_file_stub (**14411**, **13265**).
- Shipped in `scripts/bench/run_harness_swe_one.py`:
  - `_fail_to_pass_body_hint` — embed FAIL_TO_PASS assert lines in the initial prompt (before first write; no gold).
  - `_is_wrong_file_stub_diff` + `swe_wrong_file_continue` — when smoke fails and the only edit is package `__init__.py` comment/import stub, specialized early-stop inject (not generic smoke-continue).
  - Initial prompt also bans `__init__.py` comment/redundant-import diffs.
- Unit tests: `scripts/bench/test_swe_smoke_map.py` (`FailToPassHintTest.test_body_hint_embeds_assert_lines`, `WrongFileStubGateTest`); full file **24 OK**.
- Smoke High probe: **ran 2026-11-04** after GPU headroom restored (wedged non-pin `gemma4:12b` unloaded via keep_alive/stop; gpt-oss 120b+20b Forever; ~30 Gi avail; twin still no route). Not sqlfluff-1625 / not High queue resume / not Terminal Bench.
- `matplotlib__matplotlib-25433` High/`gpt-oss-20b`/`SPOCKIFY_HARNESS_THINKING=high`: **not-resolved** empty (0 B); continues fired (`continue_used: true`); wall ~541s; fail kept; **no B-05**.
- Card: `snapshots/harness-swe-runHarness-20261104-high-matplotlib__matplotlib-25433/CARD.md` (+ short `harness-high-25433-20261104`).
- Scores SoT unchanged: B-04 **27/27** · B-05 **6/27** · Lite **70/300**.

## High matplotlib-25433 smoke (planning-steer)

- eval **not-resolved** (0 B). Fail kept. No B-05. No second High id.

## Partial gate evidence — ops (2026-11-04)

- Scoring trail parked; next actionable without Tim/Hub/High: re-verify Partial gates honestly.
- Restored **PHASE4-GREEN**: IDE `agentLoop.ts` was 288 lines (budget 280); moved Auto-pin / think helpers to `agentLoopMap.ts` (279 lines; still `runHarness` bridge).
- Fixed G8 rehearsal assert: `slo.video.disabled` → `slo.video.enabled` (matches `docker/slo.json` / G6).
- Re-ran: canary `max_rounds=1`, SBOM verify (40), production-profile, `pilot-rehearsal.sh` local ok.
- **No gate promoted.** G8 Red; G0/G3–G7 Partial; Phase 5 Partial; G1-09 waived ≠ pentest.
- Scores SoT unchanged: B-04 **27/27** · B-05 **6/27** · Lite **70/300**.

## Canary red policy → SoT docs (2026-11-04)

- Policy was AGENTS-only; now in `docs/HARNESS.md#canary-pack`, PRODUCTION_READINESS caveat, BENCH, HARNESS_PROFILE.
- Red after harness PR → revert (no prompt-salvage); red pin → revert pin; `max_rounds=1` unchanged.
- No gate promote; scores unchanged. Next leftovers remain Tim-blocked / score-parked.

## High unpark (2026-11-06) — Tim ask

- Explicit High unpark: Tim “Now do the rest. Do it all!!”
- Next High batch: matplotlib-25442, sympy-16106, sympy-16281 (`gpt-oss-20b` High) on Spock.
- Skip astropy-12907 re-run; astropy-7746 deferred.
- Hub: Spock docker auths = `ghcr.io` only — no large Lite regrade until Tim supplies Docker Hub creds.
- G1-09: operator-waived 2026-10-17 ≠ independent pentest (status only; not completed in-agent).
- No Terminal Bench while B-05 open. No sqlfluff-1625 / blind N=5.

## Lite Hub-auth re-eval started (2026-11-06)

- Twin unreachable (`lab@10.0.0.10`). Spock Hub auth as `timelito` (stamp `6dc2ce0d`).
- No ERROR/incomplete residuals (`errors_remaining=0` on 70/300 board).
- Honest next: Hub-auth re-eval of merged 300 preds (Docker-only; workers=1) — not a new overnight pred board while High `matplotlib-25442` owns `gpt-oss-20b`.
- Out: `bench-out/lite-hub-reeval-20261106/` (`STATUS.md`, prune watchdog). Card stub: `snapshots/lite-hub-reeval-20261106/CARD.md`.
- Score SoT unchanged: B-04 **27/27** · B-05 **6/27** · Lite **70/300** (cite until report). No private+OSS push until score changes.
- No Terminal Bench. No sqlfluff-1625. High sibling not killed.


## High matplotlib-25442 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-16106 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-16281 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.

## Empty-chain diagnose (25442+16106+16281) — 2026-11-06

- Three consecutive High empties after continues; fail rows kept; no B-05.
- Continues + no-edit gates fired (`continue_used: true`, 0 B) — taxonomy mode A (empty_after_continues); **no new driver bug**.
- Prefer progress over churn → advance High **matplotlib-25498** (+ sympy-16503, sympy-16792).


## High matplotlib-25498 probe

- eval **not-resolved** (378 B). Fail kept. No B-05. No re-run.

## High sympy-16503 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-16792 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.

## Queue note (mpl-26011 batch)

- High batch: matplotlib-26011, sympy-16988, sympy-17022.
- After 25498 nonempty miss + 16503/16792 empties — advance (no driver churn).
- Next after: matplotlib-26020.


## High matplotlib-26011 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-16988 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-17022 probe

- eval **not-resolved** (1621 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.

## Queue note (mpl-26020 batch)

- High batch: matplotlib-26020, sympy-17139, sympy-17630.
- Last remaining matplotlib Lite id; then sympy-only queue.


## High matplotlib-26020 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-17139 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-17630 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.

## Queue note (sympy-17655 batch)

- High batch: sympy-17655, sympy-18057, sympy-18087.
- Matplotlib Lite High ids exhausted after 26020.
- Next: sympy-18189.

## Empty streak note (post-mpl) — 2026-11-07

- Through High mpl/sympy batches 25442→26020: **0 resolves** (mix empty_after_continues + nonempty misses). Continues fire; **no new driver bug**.
- Prefer progress: continue sympy-only / other unused Lite repos (not sqlfluff-1625; not thrash re-queue).


## High sympy-17655 probe

- eval **not-resolved** (439 B). Fail kept. No B-05. No re-run.

## High sympy-18057 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-18087 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.

## Chained High grind (2026-11-07)

- Detached on Spock: `/tmp/p1-grind-chain-high.sh` → `/tmp/p1-grind-chain-high/`
- Starts at sympy-18189; batches of ≤3; then seaborn/flask/requests Lite leftovers.
- Skip astropy-12907; defer 7746; no sqlfluff-1625; B-05 only on new resolve.


## High sympy-18189 probe

- eval **not-resolved** (383 B). Fail kept. No B-05. No re-run.

## High sympy-18199 probe

- eval **not-resolved** (442 B). Fail kept. No B-05. No re-run.

## High sympy-18532 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-18621 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-18698 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-18835 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-19007 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-19254 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-19487 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-20049 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-20154 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-20212 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-20322 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-20442 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-20590 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-20639 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-21055 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-21171 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-21379 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-21612 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-21614 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-21627 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-21847 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-22005 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-22714 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-22840 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-23117 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-23191 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-23262 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-24066 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-24102 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-24152 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High sympy-24213 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High sympy-24909 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High mwaskom-2848 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High mwaskom-3010 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High mwaskom-3190 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High mwaskom-3407 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High pallets-4045 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High pallets-4992 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High pallets-5063 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High psf-1963 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High psf-2148 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High psf-2317 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High psf-2674 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High psf-3362 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High psf-863 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High pydata-3364 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High pydata-4094 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High pydata-4248 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High pydata-4493 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High pydata-5131 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-10297 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-10508 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High scikit-learn-10949 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-11040 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-11281 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High scikit-learn-12471 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-13142 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-13241 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High scikit-learn-13439 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-13496 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-13497 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High scikit-learn-13584 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-13779 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-14087 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High scikit-learn-14092 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-14894 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-14983 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High scikit-learn-15512 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-15535 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-25500 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.


## High scikit-learn-25570 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-25638 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## High scikit-learn-25747 probe

- eval **not-resolved** (0 B). Fail kept. No B-05. No re-run.

## Queue note (cross-repo)

- Skipped re-run of **astropy-12907** (already resolved + B-05 empty).
- High batch: matplotlib-25442, sympy-16106, sympy-16281.
- Next: matplotlib-25498.
