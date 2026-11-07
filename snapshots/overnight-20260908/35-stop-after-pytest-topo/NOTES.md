# 35 — stop shell batch after green pytest + topo eval

## Keep (on top of 34)
1. After a successful `pytest` in the shell batch, stop — skip trailing junk cmds.
2. New harder `lab_topo_eval.py` (topo_sort + cycle → None).

## Live
- topo **q10 ~26–27s**
- Stop-after-pytest is keep; invent thrash fixed in **36** (auto-verify cap).
