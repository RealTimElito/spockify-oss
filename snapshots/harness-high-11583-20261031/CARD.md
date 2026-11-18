# High-think harness — django__django-11583

- Model: `gpt-oss-20b` · Think: `high` (`SPOCKIFY_HARNESS_THINKING`)
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-11583`
- Wall: ~362s · Events: 5723 · thinking events: 5457

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11583` | **not-resolved** | **empty** (0 ok writes) |

- Fail row kept. Unique B-04: prior 3/25 → **3/26** (new id, no resolve).
- High canary 10914 still resolved; High alone did not unlock a tracked edit here.
- Empty-diff continue was available in driver; still empty after run — residual is no write.

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-11583/CARD.md`

- Evidence commit: `a98e5fb9`
