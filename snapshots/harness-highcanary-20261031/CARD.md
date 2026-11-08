# High-think canary — django__django-10914

- Hypothesis: `SPOCKIFY_HARNESS_THINKING=high` still resolves a known-good Lite id (wiring via lab-kernel-stdio).
- Model: `gpt-oss-20b` · Lite · Spark PF `:24001`
- Run: `20261031-highcanary-django__django-10914`

## Score

| Instance | Think | Outcome | Patch |
|----------|-------|---------|-------|
| `django__django-10914` | high | **resolved** | nonempty (1277 B) |

- Thinking events: 3465 · Wall ~387s
- Unique B-04 denominator unchanged (id already resolved)
- Empty-diff continue already in harness SWE driver — not re-run on empties

Per-instance: `snapshots/harness-swe-runHarness-20261031-highcanary-django__django-10914/CARD.md`

- Evidence commit: `1c6edadd`
