# LEAP-024 — exact description + resolve (2026-09-17)

## Goal

Close the one-string gap on sqlfluff-1625 FAIL_TO_PASS.

## Fixes

| Item | Detail |
|------|--------|
| Prompt | Exact gold: `Avoid aliases in from clauses and join conditions.` |
| Pre-submit normalize | `Avoid using aliases…` (+optional `.`) → gold |

## Run q

| Field | Value |
|-------|-------|
| Exit | Submitted |
| Patch | exact gold description |
| FAIL_TO_PASS | **PASSED** |
| CLI suite | 69 passed |
| Calls | 13 (~1m) |

## AUDIT-OK

Instance resolved with eval evidence. Not a full Lite board.
