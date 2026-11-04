# Harness N=5c Lite board — 20261031 (new ids)

- Model: `gpt-oss-20b` · Driver: `@spockify/harness` runHarness
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001` (twin down)
- Gate: write-before-test + noop-apply reject (`850d775e`)
- Run id prefix: `20261031-n5c-*`
- Wall: ~24m sequential (04:21–04:46 +0100)
- Evidence commit: `e59a183c`

## Scores

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11422` | **not-resolved** | nonempty (592 B) |
| `django__django-11564` | **not-resolved** | **empty** (wrote untracked `tests/__init__.py` only) |
| `django__django-12286` | **not-resolved** | nonempty (2888 B) |
| `sympy__sympy-12419` | **not-resolved** | **empty** (0 writes) |
| `sympy__sympy-13043` | **not-resolved** | **empty** (0 writes) |

- **This batch pass@1: 0/5** (fail rows kept; no thrash of prior fails / sqlfluff / 12125/6938)
- **Cumulative unique harness freezes: 3/20** (prior 3/15 + this 0/5; resolved-any still 10914, 12907, 11039)
- Historical sqlfluff pass@1=0 unchanged

## Residual

3/5 empty final patch. Gate can still be “satisfied” by an **untracked** write that does not enter `model_patch` (11564). Noop identical SEARCH/REPLACE not observed this batch.

Per-instance cards: `snapshots/harness-swe-runHarness-20261031-n5c-*/CARD.md`
