# Harness N=5b Lite board — 20261031 (new ids)

- Model: `gpt-oss-20b` · Driver: `@spockify/harness` runHarness
- Dataset: `SWE-bench/SWE-bench_Lite` test
- Host: Spock / Spark LiteLLM `:24001` (twin down)
- Gate: write-before-test (`3c033d1c` lineage; evidence `0a1cd8e8`, ran on `ccf83ba6`)
- Run id prefix: `20261031-n5b-*`
- Wall: ~42m sequential (03:00–03:42 +0100)

## Scores

| Instance | Outcome | Patch |
|----------|---------|-------|
| `django__django-11910` | **not-resolved** | nonempty (476 B) |
| `django__django-11964` | **not-resolved** | nonempty (3567 B) |
| `django__django-12125` | **not-resolved** | **empty** (apply failed) |
| `astropy__astropy-6938` | **not-resolved** | **empty** (noop apply counted as write) |
| `astropy__astropy-7746` | **not-resolved** | nonempty (251 B) |

- **This batch pass@1: 0/5** (fail rows kept; no thrash / no sqlfluff / no OpenCode re-run)
- **Cumulative unique harness freezes: 3/15** (prior ~3/9–3/10 + this 0/5; resolved-any: 10914, 12907, 11039)
- Historical sqlfluff pass@1=0 unchanged
- N=5 (20261031) fail rows unchanged

## Residual (empty-patch gate)

Hard gate blocked test-before-write thrash, but **2/5** still ended empty_patch:
1. failed `apply_patch` then exhausted (`django-12125`)
2. noop SEARCH/REPLACE identical text satisfied “successful write” with zero git diff (`astropy-6938`)

Per-instance cards under `snapshots/harness-swe-runHarness-20261031-n5b-*/CARD.md`.
Traces under `bench-out/harness-swe-runHarness-20261031-n5b-*/`.
