# skill-one-factor

## Purpose
One change per scored run. Do not change default model and loop in the same night. Do not retune prompts during INFRA-BLOCK.

## Inputs
- Ticket id + proposed file list + model/think freeze

## Outputs
- Ready / not-ready for scored run
- Factor list (exactly one intentional factor)

## Commands
```bash
# Director gate before A4/A8 scored row
# Require: frozen model+think, canary green, no second open ticket on owned files
```

## Fail codes
- `0` one-factor ready
- `1` multi-factor / missing freeze
- `2` canary red

## May touch
TICKETS.md checkboxes, card rows

## Must not touch
Loop + model defaults together in one scored PR

## Example
```
READY ticket=LEAP-024 factor=exact-desc-prompt model=gpt-oss-20b think=low
```
