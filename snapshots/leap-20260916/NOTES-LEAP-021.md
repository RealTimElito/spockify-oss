# LEAP-021 — step budget + patch-finish skill (20b)

## Config

| Knob | Value |
|------|-------|
| `SPOCKIFY_BENCH_STEP_LIMIT` | **150** (was 100) |
| `SPOCKIFY_BENCH_COST_LIMIT` | 5.0 |
| `max_tokens` | **4096** |
| Prompt | surgical `sed`/`python3 -c`; forbid `grep -R`, `apply_patch`, tool JSON |
| Empty-stop | inject `git status -sb; git diff --stat` |
| Tool-parse 500 | soft-fail → recovery bash (bypass tenacity) |

## Runs

| Run | Outcome |
|-----|---------|
| g | **infra-fail / hung** — empty-stop + `grep -R`; snap `leap-021-lite-0-1g/container-snap/` |
| h | **infra-fail / hung** — Ollama truncated apply_patch tool-call JSON → 500 retry storm |
| i | **infra-fail / hung** ~43m — soft-fail OK; L031 rewrite (`py_compile` OK); hung LiteLLM ESTAB + qemu zombie greps; no traj |

Best **scored** row remains LEAP-020 run f (**not-resolved**, 81/100 nonempty).

## LEAP-015

**HOLD-VRAM** — see `NOTES-LEAP-015.md`.

## AUDIT-OK

Harness progress only. No SWE win claim.
