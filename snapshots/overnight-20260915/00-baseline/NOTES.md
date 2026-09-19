# 00 — overnight baseline (2026-09-15 ~22:40 CEST)

## Context
- Tip **50-exec-stream-early-stop-dsu** already committed (`6da8815`). Do not undo.
- Twin `lab@10.0.0.10` **DOWN** (no route). Prefer laptop→Spark proxies (`:3080` OWUI, `:4100` router, `:4000` LiteLLM) for light benches; no full SWE Docker wall on prod.
- Spark healthy: router `midthought-202609082212`, OWUI `spawn-label-202609082015`, XTTS 1/1, ComfyUI 0/0.
- Large WIP uncommitted: mid-thought SPAWN, lab CLI/IDE wiring, Comfy on-demand gateway, thinking panel tweaks.

## Unit tests at start
- `services/router/test_midthought_spawn.py` — 7 passed
- `packages/spockify-lab-agents/tests/` — 41 passed

## Goals tonight
1. Ship Cursor-parity quality (IDE/CLI/OWUI + harness) when bar met
2. Micro-evals / prompt+temp tuning on tip 50 foundation
3. Hotfix Spark (rsync + on-box build + set image only)
4. Push private + scrubbed OSS; leave SUMMARY + smoke list by ~07:00 Stockholm
