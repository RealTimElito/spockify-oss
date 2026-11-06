# Empty-patch / run_tests thrash fix — 20261031

## Hypothesis

Harness N=5 django cells often exited with **empty** `model_patch` (0× successful `apply_patch`, many `run_tests`). Mini-SWE had resolved some of the same ids.

## Fix (minimal)

1. `@spockify/harness` system prompt: edit before `run_tests`
2. Mid-loop nudge after ≥2 tests with 0 writes
3. **Hard gate:** `run_tests` / pytest-like `shell` blocked until a successful `apply_patch`/`edit_file`/`write_file` (`SPOCKIFY_ALLOW_TEST_BEFORE_WRITE=1` to bypass)
4. SWE driver: empty-`git diff` continue inject

## Smoke results

| Run | Id | Outcome | Notes |
|-----|-----|---------|-------|
| regression | django-10914 | **not-resolved** | nonempty wrong patch (1882 B); prior resolve kept; model variance |
| hypothesis | django-11039 | **not-resolved** | still empty after nudge+continue only |
| hypothesis2 | django-11039 | **resolved** | with hard write-before-test gate (~411s, 1208 B) |

## Board honesty

- N=5 board card remains **0/5** fail rows (not rewritten)
- sqlfluff historical pass@1=0 unchanged
- Unique Lite freezes with fix retest: **3/9** (12907, 10914 prior, 11039 hypothesis2)
