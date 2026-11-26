# 02 — orch early-stop (tip 51) + IDE Cursor HUD

## Tip 51 (on tip 50)
- `orch_stream_should_stop` once a parseable plan/review JSON is complete
- `SPOCKIFY_LAB_ORCH_MAX_TOKENS` default **1536** (was unbounded 4096)
- Do not undo tip 50 exec early-stop / 2304

## IDE Cursor-parity (feel)
- Mid-thought `agents` → status bar `Spawn · n/m` / `Merging…`
- After tools: live thought “Planning next moves…”; phase bar `planning`/`spawn`/`merging`
- Wire `status` events into phase bar; clear agents HUD on streamDone/Stopped/Error

## Tests
- lab-agents unit: orch early-stop cases added; full suite green
