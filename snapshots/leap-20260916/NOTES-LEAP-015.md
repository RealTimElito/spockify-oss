# LEAP-015 — gpt-oss:120b on sqlfluff__sqlfluff-1625

## Decision: HOLD full SWE (VRAM / live prod)

| Fact | Value |
|------|-------|
| gpt-oss:120b on disk | **65 GB** (`ollama list`) |
| Available RAM (this window) | ~**51Gi** with chat-resident 20b+8b+3b |
| Forever-resident chat | gpt-oss:20b (~12.8GB VRAM) + llama3.1:8b + llama3.2:3b |

Loading 120b for a multi-hour SWE would likely evict chat-resident models and starve Voice/chat. Playbook: short canaries OK on Spark; long SWE careful; do not wipe models.

**HOLD** LEAP-015 full Lite 0:1 on 120b until an amd64/twin window or idle Spark with chat models scaled down **by explicit human ops**.

## Meanwhile

- LEAP-021: raise `step_limit` to 150 + patch-finish prompt + max_tokens/empty-stop on **gpt-oss-20b** same instance.
- Card row for 120b remains `not run` / `HOLD-VRAM`.

## Do not

A one-shot `max_tokens=8` 120b completion still pulls ~65GB into unified memory — **do not** run casually on live Spark.
