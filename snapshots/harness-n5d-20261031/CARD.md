# Harness N=5d Lite board — 20261031 (new ids)

- Model: `gpt-oss-20b` · Driver: `@spockify/harness` runHarness
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001`
- Gate: write-before-test + noop-apply + **tracked/repo-diff** unlock
- Run id prefix: `20261031-n5d-*`
- Wall: ~28m after trackedhyp smoke (04:57–05:25 +0100)

## Scores

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-10924` | **not-resolved** | empty |
| `django__django-11019` | **not-resolved** | empty |
| `django__django-11049` | **not-resolved** | empty |
| `django__django-11133` | **not-resolved** | nonempty (2448 B) |
| `django__django-11283` | **not-resolved** | empty |

- **This batch pass@1: 0/5** (fail rows kept)
- **Cumulative unique harness freezes: 3/25** (prior 3/20 + this 0/5; resolved-any still 10914, 12907, 11039)
- Fourth consecutive 0/5 growth board (N=5, 5b, 5c, 5d) — **stop blind N growth**

Per-instance: `snapshots/harness-swe-runHarness-20261031-n5d-*/CARD.md`

- Evidence commit: `3ec4c2fb`
