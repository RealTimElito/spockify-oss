# 29 — auto-verify follow-up failure hints

## Keep (on top of 28)
When writes_ok without pytest_passed, inject a short prior-failure clue into
the auto verify follow-up task so workers fix from observations faster.

## Live
- invent (bootstrap=0): **q10 ~116s** (was ~244s) — one verify round, 3 passed
- rate regress: see runs/
- docs/rename/calc still q10 ~11–15s
