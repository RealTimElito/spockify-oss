# 23 — first-turn plan bootstrap (skip orch LLM)

Keeps 22. For pytest goals with named/workspace source files, emit a sequential
fix+verify task without calling lab-orchestrator on turn 1.
Opt-out: SPOCKIFY_LAB_BOOTSTRAP=0.

## Live (all quality 10)
- calc ~19s · shop ~20s · merge ~28s · queue ~28s · ledger ~31s · cache ~64s

New eval: lab_merge_eval.py (interval merge + covered_length).
