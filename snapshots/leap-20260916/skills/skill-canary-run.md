# skill-canary-run

## Purpose
Run the five-task canary pack (rate/hello/docs/calc/rename) on frozen `gpt-oss-20b` think=low and stamp GREEN/RED.

## Inputs
- `packs/canary-v1.json`
- `SPOCKIFY_BASE_URL` pointing at LiteLLM (not router)
- git SHA of harness

## Outputs
- stdout: `CANARY-GREEN` or `CANARY-RED`
- stamp file under `snapshots/leap-20260916/CANARY-*.txt`

## Commands
```bash
export SPOCKIFY_BASE_URL=http://127.0.0.1:24001   # Spark PF example
./scripts/canary_gate.sh leap
```

## Fail codes
- `0` green within budget
- `1` red (fail or over budget)
- `2` missing pack/script

## May touch
`snapshots/leap-20260916/runs/`, canary fixtures, stamp files

## Must not touch
`loop.py`, router pick logic, invent fixtures, model defaults

## Example
```
CANARY-GREEN pack=canary-v1 wall_s=61 budget=90 sha=4181d5b host=spock model=gpt-oss-20b think=low
```
