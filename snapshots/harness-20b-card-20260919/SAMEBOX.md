# Same-box: gpt-oss-20b × 3 fixtures (eval host)

- Date: 2026-09-19
- Host: LiteLLM `http://127.0.0.1:24001` (shared with Lite board; workers not raised)
- Spockify: `runHarness` (@spockify/harness)
- Wichy: installed from `https://github.com/wiiha/wichy` (v0.5.0 editable) on **eval host only** (not vendored into `services/`)
- Wichy model tag: `generic/127.0.0.1:24001##gpt-oss-20b` via `OPENAI_API_KEY` (= LiteLLM master key)
- Spockify model: `gpt-oss-20b`

| fixture | Spockify Y/N + layer/repair | Wichy Y/N | walls (s) Spockify / Wichy |
|---|---|---|---|
| rate_write_gate | Y · WRITE gate not hit this run (0 READ_REQUIRED) | Y | 129 / 48 |
| ws_cascade | Y · cascade L2 (scripted edit_file after model refuse) | N | 87 / 65 |
| fence_repair | Y · repair-turn Y | Y | 114 / 19 |

## Notes

- **ws_cascade** is the decisive row: fixture starts pytest-red; Spockify ends green with cascade L≥1; Wichy left `hi` (exact-match `replace_text` failed on trailing-space drift).
- **fence_repair** / **rate_write_gate** both stay green on both sides this run (tied on those two).
- Install: `git clone` + `pip install -e .` succeeded (dependency conflict warnings with unrelated host packages; package still runnable).
- Scratch logs: `/tmp/wichy-samebox-20260919/*.log`; truncated copies under `samebox-other-logs/`.

## Surpass

One fixture red on Wichy and green on `runHarness` with cascade L≥1 → measured local edge on whitespace-drifted edit. No board % claimed. sqlfluff Lite pass@1=0 untouched.
