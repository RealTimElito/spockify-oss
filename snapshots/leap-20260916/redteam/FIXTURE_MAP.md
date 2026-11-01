# Leap red-team fixture map (LEAP-004 / A12)

Replay overnight failure modes as fixtures. Do **not** invent new eval slugs.
Encode old pain so A5 cannot regress these modes.

| ID | Historical tip | Failure mode | Permanent test / fixture |
|----|----------------|--------------|--------------------------|
| RT-01 | 01 | Orch skips exec / hallucinated inspect | Force findings from shell observations |
| RT-06 | 06 | Fix then undo after DONE | Review skips when pytest_passed |
| RT-07 | 07 | Multi-JSON false-stop / DONE during verify | parse first JSON only; DONE-during-verify is harness bug |
| RT-10 | 09–10 | WRITE after DONE / bad fence | salvage + nested extract |
| RT-13 | 13 | Shop timeout 400s class | serialize edits; timeout taxonomy |
| RT-50 | 49–50 | DONE-loop ~293s | stream early-stop |
| RT-53 | 52–53 | Reasoning-only stub | stub-retry + think=low |
| RT-58 | 57–58 | Already-green 3-round thrash | preseed N passed → stop R1 |
| RT-65 | 65 | ModuleNotFound stub | force WRITE of missing module |

## Sources

- `snapshots/overnight-20260908/` (tip 50 foundation)
- `snapshots/overnight-20260915/` (tips 51–87)
- Plan table 11 / playbook A12

## Cadence

C5 red-team sample (every 8h in LEAP-LOOP-48H): replay one of RT-07, RT-50, RT-53, RT-58.

## Status

List only — unit coverage lives in `packages/spockify-lab-agents/tests/`. Expanding fixtures is A12+A5 under ticket; do not open invent-slug tips.
