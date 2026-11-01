# Harness small-model card — gpt-oss-20b × 3 fixtures

- Host: LiteLLM `http://127.0.0.1:24001` (same board path; workers not raised)
- Model: `gpt-oss-20b`
- Harness entry: `runHarness` (@spockify/harness)
- Commit SHA: `8065ff9` (card stamp)
- Date: 2026-09-19
- Same-box vs other local harness: **run** — see SAMEBOX.md (ws_cascade N there / Y here)

| fixture | resolved | repair-turn used | READ_REQUIRED hits | cascade L | wall s | commit SHA |
|---|---|---|---|---|---|---|
| rate_write_gate | Y | N | 0 | — | 129 | 8065ff9 |
| ws_cascade | Y | N | 0 | 2 | 87 | 8065ff9 |
| fence_repair | Y | Y | 0 | — | 114 | 8065ff9 |

## Notes
- **rate_write_gate**: before_green=true after_green=true
- **ws_cascade**: before_green=false after_green=true; cascade_L2; edit_applied; SCRIPTED_EDIT
- **fence_repair**: before_green=true after_green=true; REPAIR_TURN

## Cascade proof
- ws_cascade L≥1 fired: Y · resolved: Y
- Fixture design: pytest red until hi→hello; SEARCH omits trailing spaces so exact match cannot succeed.

## Surpass claim
ws_cascade: other harness N (no edit) · Spockify Y with cascade L≥1 (scripted after model refuse) + repair-turn on fence_repair. Measured edge on whitespace-drifted edit; no board % claimed. Full table in SAMEBOX.md.

sqlfluff Lite pass@1=0 historical row unchanged (do not retune).
Prior card `snapshots/harness-20b-card-20260918/` left untouched.
