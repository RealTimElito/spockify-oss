# Harness N=3 Lite board — 20261030

- Model: `gpt-oss-20b` · Driver: `@spockify/harness` runHarness
- Dataset: `SWE-bench/SWE-bench_Lite` test (prompt + official eval)
- Host: Spock / Spark LiteLLM `:24001` (twin down)

## Scores

| Instance | Outcome | Wall (card) |
|----------|---------|-------------|
| `astropy__astropy-14995` | **not-resolved** | ~316s |
| `django__django-10914` | **resolved** | ~240s |
| `django__django-11001` | **not-resolved** | ~469s |

- **Board pass@1: 1/3**
- With prior `astropy__astropy-12907` resolve: **2/4** harness Lite freezes (not a 300-board %)
- Historical sqlfluff pass@1=0 **unchanged**

Per-instance cards under `snapshots/harness-swe-runHarness-20261030-<id>/`.
