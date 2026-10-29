# LEAP-022 — hang fixes + complete scored SWE (2026-09-17)

## Goal

Finish sqlfluff__sqlfluff-1625 without infra hang; prefer resolved, else honest not-resolved.

## Fixes

| Item | Detail |
|------|--------|
| `spockify_docker_env.py` | sanitize `grep -R`/`ls -R`; `timeout -k`; pkill zombies |
| empty-stop submit | COMPLETE marker first; only if `git diff` nonempty |
| 500 soft-fail | broader LiteLLM storms |
| timeouts | model 120s; env 45s; wall 75m |
| `run_mini_swe.py` | set SWE image for custom docker env class |

## Runs

| Run | Result |
|-----|--------|
| j | aborted — submit had `git diff --stat` before COMPLETE |
| k | Submitted empty (streak submit too early) |
| l | aborted — streak=4 rarely reached with patch present |
| **m** | **Submitted nonempty · not-resolved** — SyntaxError (`\\n` literal in L031.py) |

## AUDIT-OK

Complete scored ≠ resolved. No pass@1 claim.
