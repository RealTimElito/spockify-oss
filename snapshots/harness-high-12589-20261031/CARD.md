# High-think harness — django__django-12589

- Model: `gpt-oss-20b` · Think: `high` (`SPOCKIFY_HARNESS_THINKING`)
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Run: `20261031-high-django__django-12589` on `987257ed`
- Wall: ~743s · Events: 13373

## Score

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-12589` | **not-resolved** | **empty** (0 B) |

- `swe_test_patch.applied=true`
- `swe_empty_patch_continue` fired (16 turns, `diff_bytes_pass1=0`) — still empty
- Post `swe_smoke.ok=false`
- Fail row **kept**. Unique B-04 unchanged **7/27** (N=1 ≠ board %)
- **Freezes paused** after this id — wait for wrong-patch-streak fix agent before 12700+
- Historical sqlfluff pass@1=0 unchanged

Per-instance: `snapshots/harness-swe-runHarness-20261031-high-django__django-12589/CARD.md`

- Evidence commit: `a2c49132`
