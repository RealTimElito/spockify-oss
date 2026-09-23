# Leap Forward — 2026-09-16 (updated LEAP-024)

## Status: dry-run/smoke/lab green · **SWE sqlfluff-1625 resolved** (run q)

Prod Spark LiteLLM `:24001`. gpt-oss-20b. 120b HOLD-VRAM.

## Results

[`snapshots/bench-results-20260917/RESULTS.md`](../bench-results-20260917/RESULTS.md)

| Suite | Result |
|-------|--------|
| dry-run + smoke + lab_regress | **PASS** |
| SWE sqlfluff-1625 | **resolved** (run q; FAIL_TO_PASS + CLI 69 passed) |

## LEAP-024

Exact description prompt + pre-submit drift normalize. Instance pass@1 this window: **1/1** (not a full Lite board).

## AUDIT-OK

Resolved only with eval evidence. No invented board %.

## Commit / deploy tags

- Private: `2485f43` on Spockify/Spockify
- OSS: `eabd8a7` force-pushed to Spockify/spockify-oss
- Deploy: none
