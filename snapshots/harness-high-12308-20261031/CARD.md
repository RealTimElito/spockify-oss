# High-think harness — django__django-12308

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-12308` on `3d64aebd`
- Wall: ~740s · Events: 6444

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-12308` | **not-resolved** | nonempty (3619 B) |

- `swe_test_patch.applied=true`; `swe_smoke.ok=false` → **`swe_smoke_after_continue`** (still false)
- Fail row **kept**. Unique B-04 unchanged **7/27**
- Do not thrash 12308 without new hypothesis
- sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-12308/CARD.md`

- Evidence commit: `025441e7`

- Evidence commit: `5a8e2f45`
