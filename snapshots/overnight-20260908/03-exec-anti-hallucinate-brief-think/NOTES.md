# 03 — exec anti-hallucinate + brief orch thinking + tee scoring

## Changes
- Exec: never invent ls/cat; BLOCKED if cannot observe.
- Orch: keep private reasoning short; emit JSON ASAP.
- Micro-eval: tee stdout so DONE/FINDINGS count in metrics.

## Prior best
02-force-exec: quality ~9 rescored (handoff+DONE+FINDINGS+stop), wall 206s.
