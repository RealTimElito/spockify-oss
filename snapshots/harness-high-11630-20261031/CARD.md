# High-think harness — django__django-11630

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-11630` on `cbbacf82`
- Wall: ~525s · Events: 8456

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11630` | **not-resolved** | nonempty (3944 B) |

- `swe_test_patch.applied=true`
- Local post-run `swe_smoke.ok=true` (FAIL_TO_PASS django-runtests green) but **official swebench not-resolved**
- `continue_used=false` (nonempty pass1; no empty-diff / smoke-continue inject)
- Fail row **kept**. Unique B-04 unchanged **5/27** (N=1 ≠ board %)
- Do **not** re-thrash 11630 without a new hypothesis (smoke≠official gap / PASS_TO_PASS)
- Historical sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-11630/CARD.md`

- Evidence commit: `088888a1`
