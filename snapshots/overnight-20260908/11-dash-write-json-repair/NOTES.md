# 11 — --- WRITE + JSON escape repair + empty-continue coerce

Keeps 08 stack. Builds on 09/10 WRITE harness.

## Root causes from 10-calc-nudge (quality 3)
1. Exec emitted WRITE with `---` body (not ```) → extract missed.
2. Review JSON had `\Then` (invalid escape) → parse failed → empty tasks → early stop.
3. Nudge alone insufficient.

## Fixes
- extract_writes accepts ``` and --- bodies
- _repair_json_escapes before plan JSON decode
- coerce_empty_continue: continue+[] + pytest goal → force verify task
- prompts: WRITE before DONE; full-file WRITE; valid JSON \n

## Not done
- No auto-apply WRITE from orch instructions (orch often drops helpers like sub)
