# Harness small-model card — gpt-oss-20b × 3 fixtures

- Host: LiteLLM `http://127.0.0.1:24011` (prod port-forward; workers not raised)
- Model: `gpt-oss-20b`
- Harness entry: `runHarness` (`@spockify/harness`)
- Commit SHA: `4c59b3bb` (tree at run; card not restamped)
- Date: 2026-10-17
- Same-box vs other harnesses: **not run** this day (no Wichy / OpenCode row)

| fixture | resolved | repair-turn used | READ_REQUIRED hits | cascade L | wall s | commit SHA |
|---|---|---|---|---|---|---|
| rate_write_gate | Y | N | 0 | — | 86 | 4c59b3bb |
| ws_cascade | Y | N | 0 | 2 | 25 | 4c59b3bb |
| fence_repair | Y | Y | 0 | — | 14 | 4c59b3bb |

## Notes
- **rate_write_gate**: before_green=true after_green=true
- **ws_cascade**: before_green=false after_green=true; cascade_L2; edit_applied; SCRIPTED_EDIT
- **fence_repair**: before_green=true after_green=true; REPAIR_TURN

## Cascade proof
- ws_cascade L≥1 fired: Y · resolved: Y
- Fixture design: pytest red until hi→hello; SEARCH omits trailing spaces so exact match cannot succeed.

## Honesty
No board % claimed. No OpenCode / Wichy scores. sqlfluff Lite pass@1=0 historical
row unchanged. Phase 5 stays Partial. Prior card
`snapshots/harness-20b-card-20260919/` left untouched.
