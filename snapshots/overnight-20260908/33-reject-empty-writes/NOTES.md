# 33 — reject empty WRITE bodies

## Keep (on top of 32)
Ignore whitespace-only WRITE bodies so models cannot wipe sources.

## Live
- rate **q10 ~43s** (was ~273s thrash on empty wipe)
- sched **q10 ~36s**; calc ~16s; docs ~11s
