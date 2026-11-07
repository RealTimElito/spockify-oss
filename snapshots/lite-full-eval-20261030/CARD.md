# Lite full official eval — combined (initial + 429 retry)

- Preds: `bench-out/lite-full-20260917/preds.json` (mini-SWE × `gpt-oss-20b`)
- Evaluator: `swebench.harness` · `SWE-bench/SWE-bench_Lite` test
- Host: Spock Docker (twin down); no GPU for grading

## Auth / cooldown

- **Hub auth: none** (`~/.docker/config.json` → `ghcr.io` only; no `DOCKER_HUB_*`)
- Anonymous limit observed: **100 pulls / 3600s**
- Retry: batched 80+80+33 with waits until `ratelimit-remaining ≥ batch size` (~12–60 min cooldowns)

## Combined scores (honest)

| Denominator | Resolved | Note |
|-------------|----------|------|
| **Completed** | **70/300 (23.3%)** | Prefer this (completed-denominator; clean) |
| Submitted | 70/300 | Errors cleared after pred-regen×3 |
| First-pass only | 36/106 | Historical; **never cite 36/300** |

- Unresolved: 229 · Empty patch: 1 · Remaining errors: **0**
- Pred-regen×3 (harness think=low): 12113 **resolved**, 12184 unresolved, 8506 **resolved** — card `snapshots/lite-predregen3-20261103/CARD.md`

### Initial board (`lite-full-eval-20261030`)

- 36 resolved / 106 completed / 193 errors (191× Hub 429)

### 429 retry (`lite-full-eval-429retry-20261030`)

| Batch | Resolved | Completed | Errors |
|-------|----------|-----------|--------|
| batch00 | 13 | 78 | 2 patch-apply |
| batch01 | 14 | 79 | 1 patch-apply |
| batch02 | 5 | 33 | 0 |
| **retry sum** | **32** | **190** | **3** |

## Artifacts

- Combined: `bench-out/lite-full-eval-20261030/COMBINED_WITH_429RETRY.json`
- Retry reports: `bench-out/lite-full-eval-429retry-20261030/reports/batch0{0,1,2}/`
- Auth note: `bench-out/lite-full-eval-429retry-20261030/AUTH.md`
- Sibling retry card: `snapshots/lite-full-eval-429retry-20261030/CARD.md`

## Move-on note (2026-11-03 pred-regen×3)

- Hub auth still **none**. No further anonymous 429 work.
- Residuals regenerated + re-eval'd → board **70/300** completed-denominator.
- Next: accept Partial **70/300** and park (or Hub login before any large regrade). See SUMMARY ranked leftovers.
