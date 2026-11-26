# 30 — missing-imports invent bootstrap + sched eval

## Keep (on top of 29; **do not undo 23/27/29**)
1. `missing_local_imports` + `bootstrap_missing_imports_plan` — observation-based
   (test imports without matching .py). Honors `SPOCKIFY_LAB_BOOTSTRAP=0`.
2. Run missing-imports bootstrap **before** generic pytest bootstrap.
3. Pytest bootstrap sources limited to `.py`/`.json` (ignore README.txt).
4. New harder eval: `lab_sched_eval.py` (priority FIFO scheduler).

## Live
- invent + bootstrap: **~68s** q10 (was orch ~116s); summary "invent missing paths.py"
- invent luck path ~15s when model nails slugify first try (earlier wrong README boot)
- sched: **q10 ~42s**
- Opt-out still forces orch invent (anti-overfit)

## Anti-overfit
Invent default eval keeps bootstrap=0; tag `*-boot*` enables missing-imports path.
