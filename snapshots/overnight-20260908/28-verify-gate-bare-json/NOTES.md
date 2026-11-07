# 28 — verify-gate fix + bare JSON WRITE + harder evals

## Keep (on top of 27; **do not undo 23/27**)
1. `goal_needs_pytest_verify`: "Do not run spockify lab" no longer disables real
   verify goals (was matching naive `do not run` + WRITE…pytest).
2. Bare `{…}` JSON body after `WRITE: path` (no fence).
3. Orch/exec prompt: WRITE path then fence (not WRITE inside fence); invent tip.
4. New evals: `lab_rate_eval.py` (TokenBucket), `lab_invent_eval.py` (orch-only invent).

## Live
- rate (after gate fix): bootstrap + q10 ~106s (harder logic; 2-round verify)
- invent (bootstrap=0): orch q10 ~244s
- docs/rename/calc regress still q10 ~11–15s
