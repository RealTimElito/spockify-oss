# High-think harness — django__django-12497

- Model: `gpt-oss-20b` · Think: `high` (`SPOCKIFY_HARNESS_THINKING`)
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-12497` on `06e58072`
- Wall: ~653s · Events: 15550

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-12497` | **not-resolved** | nonempty (444 B) |

- `swe_test_patch.applied=true`
- `continue_used=true`; smoke / smoke_after_continue both false
- Fail row **kept**. Unique B-04 unchanged **7/27** (N=1 ≠ board %)
- Not High-empty — next fresh High `12589`
- Historical sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-12497/CARD.md`

- Evidence commit: `6708ae41`
