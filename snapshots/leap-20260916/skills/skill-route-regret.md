# skill-route-regret

## Purpose
Score routing policies on `packs/route-v1.json`: always-20b, always-120b-high, auto, lab-orch-default. Report regret vs oracle; policy violations must be 0 on spark.

## Inputs
- `packs/route-v1.json`
- Optional live picker (else offline policy simulation)

## Outputs
- Regret table (family accuracy, pass@1 by bucket, escalation P/R, violations)
- Stamp under `snapshots/leap-*/cards/` or stdout

## Commands
```bash
python3 scripts/bench/route_regret.py --pack packs/route-v1.json
# or: spockify bench route --pack packs/route-v1.json
```

## Fail codes
- `0` report printed
- `1` pack invalid / violations on spark profile
- `2` missing pack

## May touch
`packs/route-v1.json`, `scripts/bench/route_regret.py`, card drip notes

## Must not touch
eval_board as coding score; invent competitor pass@1; enable abliterated on spark

## Example
```
policy=always-20b easy_regret=0 hard_regret=high violations=0
policy=auto easy_regret=+12% (flag coding auto OFF until negative)
```
