# Empty-diff continue probe — django__django-11133

- Hypothesis: continue machinery helps a prior **nonempty-fail** (N=5d) toward resolve.
- Model: `gpt-oss-20b` · Think: `high` · Lite · Spark PF `:24001`
- Run: `20261031-emptycont-django__django-11133`
- `SPOCKIFY_HARNESS_SWE_CONTINUE_TURNS=24`
- Wall: ~421s · Events: 6641 · ok writes: 10

## Score

| Side | Outcome | Patch |
|------|---------|-------|
| Prior N=5d | **not-resolved** | nonempty 2448 B · `continue_used=false` |
| This probe | **resolved** | nonempty 2543 B · `continue_used=false` |

## Did empty-diff continue help?

**No — it did not fire.** Pass1 already had a nonempty git diff (`pass1_bytes=2543`), so `swe_empty_patch_continue` was skipped. Smoke continue also did not fire (`swe_smoke ok=null` — pytest missing in smoke venv). Resolve is from a better High first-pass patch, not from continue inject.

- Prior N=5d fail row **kept**.
- Unique B-04: prior 3/27 → **4/27** (11133 now resolved-any; still one unique id).

Per-instance: `snapshots/harness-swe-runHarness-20261031-emptycont-django__django-11133/CARD.md`

- Evidence commit: `45446755`
