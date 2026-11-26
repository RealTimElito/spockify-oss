# High-think harness — django__django-12284

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-12284` on `c7995ed6`
- Wall: ~750s · Events: 17351

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-12284` | **not-resolved** | nonempty (559 B) |

- `swe_test_patch.applied=true`; smoke fail → **`swe_smoke_after_continue`** (still fail)
- Fail row **kept**. Unique B-04 unchanged **7/27**
- Do not thrash 12284 without new hypothesis
- sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-12284/CARD.md`

- Evidence commit: `3d64aebd`

- Evidence commit: `97171a41`
