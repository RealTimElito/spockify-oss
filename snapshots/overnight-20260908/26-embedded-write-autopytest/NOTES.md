# 26 — embedded WRITE fences + auto-pytest after preseed filter

## Keep (on top of 23–25; **do not undo 23**)
1. `_WRITE_EMBEDDED_FENCE_RE` — ```\nWRITE: path\nbody\n``` salvage after DONE
2. Merge `extract_pytest_after_done` even when other RUN: lines exist
3. After WRITE, re-add `pytest -q` if preseed filter dropped salvaged pytest
4. All of 24–25: docs bootstrap, tighter pytest-verify, inspect review-skip

## Live twin (q10)
| Eval | Wall |
|------|------|
| ledger | **~25s** (≤23 ~31s) |
| shop | **~19s** (≈23) |
| calc | ~17–22s |
| docs (24) | ~12s |
| micro skip review (25) | ~100s |

## Opt-out
`SPOCKIFY_LAB_BOOTSTRAP=0` still disables first-turn plan bootstrap.
