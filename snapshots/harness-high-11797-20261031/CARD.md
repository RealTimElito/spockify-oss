# High-think harness — django__django-11797

- Model: `gpt-oss-20b` · Think: `high` (`SPOCKIFY_HARNESS_THINKING`)
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-11797` on `088888a1`
- Wall: ~394s · Events: 8473 · thinking events: ~8333

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11797` | **not-resolved** | **empty** (0 B) |

- `swe_test_patch.applied=true`
- `swe_empty_patch_continue` fired (16 turns, `diff_bytes_pass1=0`) — still empty
- Post `swe_smoke.ok=false` (FAIL_TO_PASS still red)
- Fail row **kept**. Unique B-04 unchanged **5/27** (N=1 ≠ board %)
- One High-empty after nonempty 11630 — not a consecutive High-empty chain; next High on fresh `11848`
- Historical sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-11797/CARD.md`

- Evidence commit: `28129aa2`
