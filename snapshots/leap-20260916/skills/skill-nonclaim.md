# skill-nonclaim

## Purpose
Keep public docs honest. Forbidden: beats OpenCode/Cursor/Claude Code; “Spockify 80%”; quality/10 as frontier skill; abliterated as product model.

## Inputs
- Diff or paragraph destined for README / BENCHMARK_COMPARISON / cards

## Outputs
- `AUDIT-OK` or `AUDIT-BLOCK` + the leaking sentence

## Commands
```bash
# Human/Director: read card PR; stamp AUDIT-OK|BLOCK in TICKETS / card footer
rg -n 'beats OpenCode|Spockify 80%|abliterated.*coding model' docs/
```

## Fail codes
- `0` AUDIT-OK
- `1` AUDIT-BLOCK

## May touch
`docs/BENCHMARK_COMPARISON.md`, `docs/BENCH.md` addenda, card footers

## Must not touch
Invent foreign leaderboard numbers; paste third-party % as Spockify

## Example
```
AUDIT-OK — “SWE path instrumented; sqlfluff-1625 resolved on gpt-oss-20b (N=1).”
AUDIT-BLOCK — “Beats OpenCode on SWE.”
```
