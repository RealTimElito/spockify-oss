# Lite 429 retry — lite-full-eval-429retry-20261030

- Input: `bench-out/lite-full-eval-20261030/preds-errors-only.json` (193 Hub-error IDs from first pass)
- Auth: **none** (anonymous Hub; see `AUTH.md`)
- Cooldown: wait until remaining ≥ batch need; window **60 min / 100 pulls**
- Orch finished `2026-10-30T22:15:09+01:00` (stale `run-batches.sh` killed after finish)

## Retry scores

| Batch | Submitted | Completed | Resolved | Unresolved | Errors |
|-------|-----------|-----------|----------|------------|--------|
| batch00 | 80 | 78 | 13 | 65 | 2 |
| batch01 | 80 | 79 | 14 | 65 | 1 |
| batch02 | 33 | 33 | 5 | 28 | 0 |
| **Total** | **193** | **190** | **32** | **158** | **3** |

Prefer cite **32/190 (16.8%)** among completed for the retry alone. Errors are patch-apply (not Hub 429):
`django__django-12113`, `django__django-12184`, `sphinx-doc__sphinx-8506`.

## Combined with first pass (`lite-full-eval-20261030`)

| Phase | Resolved | Completed | Errors |
|-------|----------|-----------|--------|
| Initial | 36 | 106 | 193 (191× Hub 429) |
| This retry | 32 | 190 | 3 patch-apply |
| **Union** | **68** | **296** | **3** |

Prefer cite **68/296 (23.0%)**. Never cite truncated first-pass 36/300 as board %.  
Combined card: `snapshots/lite-full-eval-20261030/CARD.md`.
