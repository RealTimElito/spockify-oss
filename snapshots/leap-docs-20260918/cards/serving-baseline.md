# Serving baseline — OC-INFRA-01…04

Date: 2026-09-18  
Host rule: SWE/eval knobs only; **not** prod chat defaults. Lite board `lite-full-20260917` owns Spark LiteLLM 20b — do not contend.

## OC-INFRA-01 Serving baseline

| Field | Value |
|-------|-------|
| Engine (chat/SWE path) | Ollama via Spark LiteLLM (board PF `:24001`) |
| Workers | 1 (board) |
| Model in flight | `gpt-oss-20b` |
| gpt-oss:120b profile | **HOLD** — HOLD-VRAM + board contention; do not load 120b tonight |
| TTFT / tok/s / VRAM | Not measured this window (would starve board) |
| Context tokens consumed | n/a until 120b night |

Follow-up: one `gpt-oss:120b think=high` request on twin or Tim-safe Spark window; write numbers here.

## OC-INFRA-02 FP8 KV trial

**Deferred.** Requires OC-INFRA-01 baseline + canary stamp. Do not enable on prod chat path during board.

## OC-INFRA-03 Context policy

Documented in `docs/BENCH.md`:

- Chat default context target: **32,768**
- SWE jobs: allow **64k–128k** per job when instance needs it
- Do **not** hard-cap eval at 16,384

## OC-INFRA-04 Confidential Computing

Spock amd64 Docker SWE host + Spark microk8s Ollama: **CC not enabled** for this eval path (standard Docker/microk8s). No-CC A/B not applicable. Do not advertise CC speedups.

## Allowed public line (when numbers exist)

“On HOST, engine E, FP8 KV reduced VRAM from A to B GiB; canary still green; Lite 0:1 outcome unchanged|changed.”
