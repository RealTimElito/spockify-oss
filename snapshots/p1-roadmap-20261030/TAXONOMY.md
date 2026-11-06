# Offline trajectory taxonomy (2026-11-03)

**Partial evidence only.** Mined from existing High/Lite/B-05 cards + `SUMMARY.md` / `NOTES.md` rows. Light card Diff lines; no new freezes, no sqlfluff-1625 re-run, no Terminal Bench, no High empties, no new Lite denom. Hub auth skipped.

**Scores SoT (unchanged):** B-04 **27/27** · B-05 **6/27** · Lite **70/300**.

Corpus: **130** High rows in `SUMMARY.md` (unique-slice freezes + later High queue + post-slice). Early unique resolves that predate the High table are **not** double-counted here; B-04 unique **27/27** stays the closed slice SoT.

---

## High freeze outcomes (n=130)

| Mode | Count | Share | Example instance ids (cite) |
|------|------:|------:|-----------------------------|
| **empty_after_continues** | **50** | 38% | 13590, 13658, 13710, 13757, 13933, 14017, 14155, 14238, 14667, 14915, 14997, 14999, 15061, 15202, 15213, sympy-14774, matplotlib-25332 |
| **nonempty_miss** (direct) | **46** | 35% | 13158, 13220, 13321, 14608, 14672, 14787, 15400, 15498, 15695, 15814, 16139, sympy-11400, matplotlib-22711 |
| **resolved** (in High table) | **18** | 14% | 12915, 13447, 13551, 13660, 13768, 14016, 14382, 14534, 14580, 14752, 14855, 15347, 15388, 15781, 15789, 15790, 15851, 16041 |
| **nonempty_via_continues_miss** | **5** | 4% | 13230, 13401, 13448, 13925, 15252 |
| **resolved_post_slice** | **4** | 3% | 16046, 16379, 16527, sympy-14396 |
| **empty_early_fail** (pre-continue-era) | **3** | 2% | 12983, 13028, 13033 |
| **nonempty_wrong_file_stub** | **2** | 2% | 13265, 14411 |
| **infra_corrupt_test_patch** | **1** | <1% | 13315 (`.strip()` on test_patch; fixed `8e7690d8`) |
| **eval_patch_apply_error** | **1** | <1% | 13964 |

**Top-2 modes (≈73% of High rows):** `empty_after_continues` + `nonempty_miss` (+ via-continues / wrong-file subtypes below).

---

## Top mode A — empty after continues (50)

Card Diff language is consistent: `empty (0 B; empty+no-edit continues…)` or `empty (0 B after continues)`.

| Subtype (from NOTES diagnose + Diff) | Approx | Citations |
|--------------------------------------|-------:|-----------|
| Continues + no-edit gates **fired**; still 0 B (model-empty / noop SEARCH-REPLACE / failed apply) | ~50 | Chains: **13590/13658**, **13710/13757**, **14017/14155/14238**, **14915/14997/14999**, **15061/15202/15213** |
| Documented **0 edit attempts** (grep/read/run_tests only) | few | 13590 (NOTES); 14238 (0 edit_starts) |
| Documented **noop / failed apply** still 0 B | few | 13658 (2 `apply_patch` failed); 14017/14155 (noop identical SEARCH/REPLACE) |

**Driver read:** empty-continue / no-edit / empty-after-no-edit injects already fire (`NOTES` empty-chain diagnoses). **Not** a missing-continue bug. Residual is model refusal to produce a productive edit under High.

Cards: `snapshots/harness-high-14017-20261101/CARD.md`, `…/14238-…`, `…/13590-…`, `…/14915-…`.

---

## Top mode B — nonempty not resolved (53 combined)

| Subtype | Count | Citations |
|---------|------:|-----------|
| **nonempty_miss** (pass1 or final nonempty; eval miss) | 46 | 13158, 13321, 14608, 14787, 15400, sympy-*/matplotlib-* later queue |
| **nonempty_via_continues_miss** (empty pass1 → continue → nonempty; still miss) | 5 | 13230, 13401, 13448, 13925, 15252 |
| **nonempty_wrong_file_stub** | 2 | **13265** (wrong file; smoke-continue no further edit), **14411** (`django/__init__.py` comment stub) |

### Nonempty miss — cited flavors (not a full re-label of all 46)

| Flavor | Citations | Note |
|--------|-----------|------|
| smoke fail after nonempty / via-continues | 13401, 13448, 13925 | Continue grew a patch; local smoke still fail → official miss |
| smoke ok / ran ≠ official | 14608 (`smoke ok≠official`), 14787 (`smoke ok=null`) | Local smoke not predictive of harness eval |
| max turns exhausted | 14672 | 9331 B; `continue_used=false` |
| wrong-file / stub | 13265, 14411 | Strong candidate for early-stop heuristic **if** pursued |
| wrong-logic vs description-string gold | sqlfluff-1625 card **f** | Nonempty wrong L031 heuristic; gold is one-line description — **planning**, not missing gate. **Do not re-run** without new hypothesis. Card: `snapshots/harness-swe-runHarness-20261030f/CARD.md` |

---

## Infra / rare (already fixed or one-off)

| Mode | Count | Citation | Status |
|------|------:|----------|--------|
| corrupt test_patch via `.strip()` | 1 | 13315 | Fixed `8e7690d8` (preserve bytes; infra-skip; missing-F2P smoke skip) |
| official eval patch-apply error | 1 | 13964 | Fail kept; hunk on `tests/many_to_one/models.py` |
| infra `fetch failed` (LiteLLM) | 0 fail rows | 14855 first attempt | Discarded; retry resolved — **not** a taxonomy fail bucket |

---

## B-05 same-model OpenCode (SoT match **6/27**)

Outcome mix among documented OC cells (early NOTES table + SUMMARY B-05 SHA rows). **Do not invent a new match %.**

| OC outcome | Role | Example ids |
|------------|------|-------------|
| **oc_match** (both resolved) | **6** SoT | 10914, 14382, 14855, 15347, 16379, 16527 |
| **oc_empty** (harness resolved, OC empty) | majority of misses | 12915, 13447, 13551, 13768, 14016, 14534, 14752, 15388, 15781, 15789, 15851, 16041, 12907, 11039, … |
| **oc_nonempty_miss** | minority of misses | 11422, 12700, 13660, 14580, 15790, 16046, 12453, sympy-14396 |

**Read:** B-05 gap is mostly **OpenCode empty** on harness-resolved ids, not harness empty. Closing B-05 still needs **new harness resolves** (then OC cell), not empty-chain freezes.

---

## Lite (SoT **70/300** Partial)

| Slice | Outcome | Citation |
|-------|---------|----------|
| Pred-regen×3 (malformed residuals) | 2 resolved / 1 unresolved / 0 empty / 0 errors | 12113 resolved, 12184 unresolved, 8506 resolved — `snapshots/lite-predregen3-20261103/CARD.md` |
| Full board | **70/300** completed-denom | Parked; Hub auth none; no new denom |

Lite does **not** change the High top-2 taxonomy; it only confirms pred quality on three residual ids.

---

## Implications for next harness work

**Honest verdict:** taxonomy does **not** prove a new mechanical driver/gate bug. Continues and no-edit already fire on empty chains; sqlfluff residual is wrong-logic vs description gold.

**Ranked next (still plan-gated; no freeze this turn):**

1. ~~**Planning / steer (top mode B)**~~ **done 2026-11-04** — F2P-body-before-write + wrong-file `__init__` early stop in `run_harness_swe_one.py` (cites **14411 / 13265**); unit-tested. Smoke High **ran** (`matplotlib-25433` empty after continues → mode A). Description-class still only if more gold-pattern misses accumulate beyond sqlfluff-1625.
2. **Do not** chase empty_after_continues with more High empties — injects work; thrash ban stands.
3. **Driver/gate PR** only if a future trace shows continue/must-edit not firing, test_patch byte regression, or smoke infra false-negative — none shown as systemic in this mine.
4. After a **new** harness resolve → B-05 that id only → then reconsider Lite pred freshness.

---

## Remaining P1 leftovers (after this taxonomy)

| Leftover | Status |
|----------|--------|
| Offline trajectory taxonomy | **done** (this file; Partial) |
| Planning steer (F2P-body / wrong-file) | **done** 2026-11-04 |
| One unused Lite High smoke | **done** — `matplotlib__matplotlib-25433` empty not-resolved (fail kept; no B-05) |
| Driver/gate fix from taxonomy | **idle** — no proven mechanical miss |
| B-05 | **open** 6/27 — needs new harness resolve |
| Lite full-board / Hub auth | **parked** / skipped (no Tim creds) |
| High queue | **parked** |
| sqlfluff-1625 / blind N / Terminal Bench | **banned** until new hypothesis |
| Marketing honesty | done |

Pointer: `SUMMARY.md` § Next · Scores SoT: B-04 **27/27** · B-05 **6/27** · Lite **70/300**.
