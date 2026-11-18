# Tracked/repo-diff write gate — hypothesis smoke

- Hypothesis: untracked-only writes (e.g. `tests/__init__.py`) must **not** unlock `run_tests` / count as empty-patch-gate success; require tracked `git diff` visible change (`isTrackedRepoDiff`).
- Model: `gpt-oss-20b` · Lite · Spark PF `:24001`
- Instance: `django__django-11564` (N=5c untracked-only empty) — **one** smoke only
- Run: `20261031-trackedhyp-django__django-11564`

## Score

| Instance | Outcome | Patch | Gate |
|----------|---------|-------|------|
| `django__django-11564` | **not-resolved** | empty | `run_tests` blocked ×3 for missing tracked/repo-diff write; 0 ok writes |

- Unit: `tracked repo-diff write gate` in `packages/spockify-harness/test/harness.test.ts`
- Prior N=5c fail row for 11564 kept; this smoke does not change unique denominator

- Evidence commit: `3ec4c2fb`
