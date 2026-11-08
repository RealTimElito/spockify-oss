# Harness small-model card — gpt-oss-20b × 3 fixtures

- Host: LiteLLM `http://127.0.0.1:24001` (same board path; workers not raised)
- Model: `gpt-oss-20b`
- Harness entry: `runHarness` (@spockify/harness)
- Commit SHA: `d139070` (card stamp follow-up `1be2efd`)
- Date: 2026-09-18
- Wichy same-box: not run (binary not installed on this host)

| fixture | resolved | repair-turn used | READ_REQUIRED hits | wall s | commit SHA |
|---|---|---|---|---|---|
| rate_write_gate | Y | N | 4 | 219 | d139070 |
| ws_cascade | N | N | 0 | 195 | d139070 |
| fence_repair | Y | Y | 0 | 547 | d139070 |

## Notes
- **rate_write_gate**: before_green=true after_green=true; WRITE_GATE_HIT
- **ws_cascade**: before_green=true after_green=true
- **fence_repair**: before_green=true after_green=true; REPAIR_TURN

## Surpass claim

Repair-turn fired on `fence_repair` (bash markdown fence → repair hint → tools) while staying green — that is a measured local-model edge vs native-tools-only drops. `ws_cascade` stayed green but the model did not apply the edit (no cascade L≥1 save this run). WRITE gate hit 4× on `rate_write_gate`. No board % claimed; at most tied on units where cascade did not engage.

sqlfluff Lite pass@1=0 historical row unchanged (do not retune).
