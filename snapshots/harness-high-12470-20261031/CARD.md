# High-think harness — django__django-12470

- Model: `gpt-oss-20b` · Think: `high` (`SPOCKIFY_HARNESS_THINKING`)
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-12470` on `64a1737c`
- Wall: ~531s · Events: 7372

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-12470` | **not-resolved** | nonempty (1837 B) |

- `swe_test_patch.applied=true`
- `continue_used=true`; smoke false then smoke_after_continue null (import error)
- Fail row **kept**. Unique B-04 unchanged **7/27** (N=1 ≠ board %)
- Not High-empty — next fresh High `12497`
- Historical sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-12470/CARD.md`

- Evidence commit: `971bdf8c`
