# High-think harness — django__django-11905

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-11905` on `29a13bcf`
- Wall: ~425s · Events: 6020

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11905` | **not-resolved** | nonempty (1906 B) |

## Reliability (important)

1. `swe_test_patch.applied=true`
2. `swe_empty_patch_continue` (pass1 empty) → agent wrote 1906 B
3. `swe_smoke.ok=false` (FAIL_TO_PASS real fail)
4. **`swe_smoke_after_continue` fired** (nonempty-diff gate satisfied) — still `ok=false` after
5. Official swebench **not-resolved**

- Fail row **kept**. Unique B-04 unchanged **6/27**
- Do not thrash 11905 without new hypothesis (smoke-continue alone insufficient)
- Historical sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-11905/CARD.md`

- Evidence commit: `942d7545`
