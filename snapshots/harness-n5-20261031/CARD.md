# Harness N=5 Lite board — 20261031

- Model: `gpt-oss-20b` · Driver: `@spockify/harness` runHarness
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001` (twin down)

## Scores

| Instance | Outcome |
|----------|---------|
| `django__django-11039` | **not-resolved** |
| `django__django-11099` | **not-resolved** |
| `django__django-11179` | **not-resolved** |
| `django__django-11620` | **not-resolved** |
| `django__django-11815` | **not-resolved** |

- **This batch pass@1: 0/5** (fail rows kept; no thrash)
- **Cumulative harness freezes: 2/9** (prior 2/4 + this 0/5)
- Note: several of these were resolved under mini-SWE Lite N=25 — harness gap, not invented scores
- Historical sqlfluff pass@1=0 unchanged
