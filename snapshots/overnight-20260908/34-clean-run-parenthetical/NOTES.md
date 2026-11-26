# 34 — strip trailing RUN parentheticals

## Keep (on top of 33)
`RUN: pytest -q (verification)` → `pytest -q` so allowlist does not fail.

## Live context
- invent-boot **q10 ~25s** (stack 33 era)
- LRU **~27s**; rate/sched ~36–43s; fast suite ~11–20s
