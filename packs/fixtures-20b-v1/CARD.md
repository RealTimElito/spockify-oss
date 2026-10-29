# fixtures-20b-v1

Small `runHarness` cards for gpt-oss-20b. Not a SWE board. Do not retune sqlfluff. Phase 5 stays Partial.

| Case | Oracle | Mock | Live 20b |
| --- | --- | --- | --- |
| `drifted_edit/` | SEARCH without trailing spaces still writes (cascade L1); pytest green | yes | not run |
| `missing_path/` | `apply_patch` without `path` → `path required`; file unchanged | yes | not run |
| `prose_instead/` | zero-tool tutorial → one doer continue inject, then stop | yes | not run |

Harness tests: `packages/spockify-harness/test/fixtures-20b-v1.test.ts`.

Live: set `FIXTURES_20B_LIVE=1` and a 20b LiteLLM key when eval GPU is free. Skip if canary or chat is using the card.
