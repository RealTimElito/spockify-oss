# High-think harness — django__django-11999

- Model: `gpt-oss-20b` · Think: `high`
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-11999`
- Wall: ~275s · Events: 5519

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11999` | **resolved** | nonempty (1587 B) |

- `swe_test_patch.applied=true`; empty-diff continue → fix; post smoke ok=true
- Unique B-04: **6/27 → 7/27** (+11999). N=1 ≠ board %
- Prior fail rows kept (11630, 11797, 11905, N=5*, sqlfluff)

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-11999/CARD.md`

- Evidence commit: _(this push)_
