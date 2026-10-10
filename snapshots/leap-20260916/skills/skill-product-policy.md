# skill-product-policy

## Purpose
Enforce product defaults: local OSS tags only; no abliterated; no `:cloud`; no Heavy-as-coder; no invent-slug tips for scored leaps.

## Inputs
- Host profile (`SPOCKIFY_HOST_PROFILE=spark|…`)
- Candidate model tags / ticket scope

## Outputs
- PASS / Sev-0 violation list
- Ticket reject reason if anti-ticket

## Commands
```bash
python3 scripts/bench/check_product_policy.py --profile spark
pytest scripts/bench/test_product_policy.py -q
```

## Fail codes
- `0` clean
- `1` policy violation
- `2` misconfigured profile

## May touch
Policy linter scripts, router tests, docs AUDIT lines

## Must not touch
Twin-only private A/B memos as homepage rows; promote abliterated LoRAs

## Example
```
PASS profile=spark forbidden=[abliterated,:cloud] violations=0
```
