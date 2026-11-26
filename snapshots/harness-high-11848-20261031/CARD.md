# High-think harness — django__django-11848

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-11848` on `57ab9167`
- Wall: ~160s · Events: 1132

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11848` | **resolved** | nonempty (1445 B) |

- `swe_test_patch.applied=true`; no continue needed; post `swe_smoke.ok=true`
- Unique B-04: **5/27 → 6/27** (+11848). N=1 ≠ board %
- Prior fail rows kept (11630, 11797, N=5*, sqlfluff pass@1=0)

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-11848/CARD.md`

- Evidence commit: `b6c5c399`
