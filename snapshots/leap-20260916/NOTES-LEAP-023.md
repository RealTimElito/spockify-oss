# LEAP-023 — syntax-safe submit + SWE near-miss (2026-09-17)

## Fixes

| Guard | Purpose |
|-------|---------|
| Block sed `\\n` / `/a\\` | Prevent literal backslash-n SyntaxError (run m) |
| py_compile before COMPLETE | Refuse invalid Python submits |
| Revert broken `.py` on compile fail | Escape IndentationError submit loops (run n) |
| Prompt | pathlib edits; smallest L031 description fix |

## Runs

| Run | Result |
|-----|--------|
| n | aborted — compile gate held; stuck on IndentationError |
| **o** | Submitted clean description edit; **not-resolved** (FAIL_TO_PASS string mismatch) |
| p | same near-miss |

## Why not resolved

Gold: `Avoid aliases in from clauses and join conditions.`  
Model: `Avoid using aliases in from clauses and join conditions`

## AUDIT-OK

Harness progress + honest not-resolved. No pass@1 claim.
