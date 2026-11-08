# High-think harness — django__django-12453

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-12453` on `5a8e2f45`
- Wall: ~304s · Events: 5141

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-12453` | **not-resolved** | nonempty (2166 B) |

- `swe_test_patch.applied=true`; empty-diff continue → patch
- `swe_smoke.ok=null` (infra/collection skip) — smoke-continue inject **not** fired
- Fail row **kept**. Unique B-04 unchanged **7/27**
- Do not thrash without new hypothesis
- sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-12453/CARD.md`

- Evidence commit: `64a1737c`
