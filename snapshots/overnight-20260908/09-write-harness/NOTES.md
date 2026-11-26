# 09 — WRITE: harness + no parallel same-file edits

Keeps 08. Adds:
1. WRITE: path + fenced body → safe on-disk write (no sed fragility)
2. Orch: don't parallel-edit same file; prefer sequential bugfix tasks
3. Tool loop applies WRITE/RUN before DONE break

Hypothesis: harder calc_pkg (fix add + add multiply) succeeds more reliably.
