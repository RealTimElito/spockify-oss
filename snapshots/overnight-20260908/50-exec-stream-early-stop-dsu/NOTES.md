# 50 — exec stream early-stop + DSU invent

## Keep (on top of 49)
1. Stop exec SSE early when DONE+WRITE ready, or ≥3 DONE loops (`StreamEarlyStop`).
2. Exec `max_tokens` default 2304 (`SPOCKIFY_LAB_EXEC_MAX_TOKENS`).
3. New harder invent `lab_dsu_eval.py` (Union-Find).

## Live
- rate **q10 ~16s** (was ~293s stream-loop thrash)
- See suite for 50b-rate / dsu / invent / heap / docs / rpn

## Do not undo
49 / 47 / 46 / 44 / 42 / 34.
