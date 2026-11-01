# Spockify coding benchmarks

Run the stack against coding evals (SWE-bench Lite first). **Lab twin or OSS compose only** — do not point this at prod Spark for long GPU jobs.

## Recommendation (what to build first)

1. **Now:** `spockify bench` / `scripts/run-swebench.sh` — probe LiteLLM, smoke one coding completion, optional **SWE-bench Lite** via [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent) (`--slice 0:1` / `--filter`).
2. **Next:** SWE-bench Verified smoke (still sliced); local `swebench.harness` eval when Docker/Podman is ready on twin.
3. **Later / avoid first:** full SWE-bench (thousands of Docker images), OpenHands mega-harness, Heavy ensemble as a coding agent, Tab/FIM changes.

Existing latency probes stay separate: `make benchmark-router`, `scripts/bench-tab-model.py`. Router `eval_board` is prompt-arena, not repo repair.

## How it talks to the stack

| Surface | Role for benches |
|---------|------------------|
| **LiteLLM** `:4000` (compose) / **`:30400`** (lab NodePort) | OpenAI-compatible `/v1/chat/completions` — primary driver |
| Open WebUI `:3080` / `:30080` | Login / model list only; harness remaps to LiteLLM |
| Router `:4100` / `:30100` | Prefer LiteLLM for agent benches (stable `/v1`); router is for chat routing |
| `spockify lab` | Closed-loop orch/exec — **not** the SWE-bench agent scaffold |
| IDE agent | Manual / exploratory; not batch-scored |

Auth: `SPOCKIFY_API_KEY` / `LITELLM_MASTER_KEY` / `~/.config/spockify/credentials.json` (same as CLI).

Models: local Ollama tags only (`gpt-oss-20b`, `gpt-oss:120b`, `codestral`, `lab-executor`, …). No cloud / `:cloud` tags. Abliterated / lab dual-role aliases are **twin-only**.

## Cost / time (order of magnitude)

| Mode | GPU | Wall time | Notes |
|------|-----|-----------|--------|
| `dry-run` | none | seconds | `/v1/models` + tiny chat |
| `smoke` | light | ~10–60s | one coding completion |
| Lite `slice 0:1` | heavy | ~15–90 min/instance | Docker per instance + many agent turns |
| Lite full (~300) | very heavy | days | twin only; concurrency 1–2 on GB10 |
| Verified / full SWE-bench | extreme | weeks | Docker image pull wall; do not run on prod |

Keep concurrency low (`--workers 1`, maybe 2). Do not wipe Ollama models between runs.

## Quick start

```bash
# Twin
export SPOCKIFY_LAB_HOST=<twin-host>   # or SPOCKIFY_BASE_URL=http://<host>:30400
export LITELLM_MASTER_KEY=…            # twin secret / device key

# Compose
export SPOCKIFY_BASE_URL=http://127.0.0.1:4000

spockify bench dry-run
spockify bench smoke --model gpt-oss-20b

# SWE-bench Lite — one instance (installs mini-swe-agent only when you ask)
spockify bench swe --subset lite --slice 0:1 --model gpt-oss-20b --workers 1
# or:
./scripts/run-swebench.sh swe --subset lite --slice 0:1 --model gpt-oss-20b
```

Outputs land under `./bench-out/` (gitignored pattern; override with `--output`).

## Config knobs

| Flag / env | Default | Meaning |
|------------|---------|---------|
| `--base-url` / `SPOCKIFY_BASE_URL` | discover | LiteLLM or OWUI (auto-remapped) |
| `--model` / `SPOCKIFY_BENCH_MODEL` | `gpt-oss-20b` | Worker model id on LiteLLM |
| `--subset` | `lite` | `lite` \| `verified` \| dataset path |
| `--slice` | `0:1` | Instance range (keep tiny until proven) |
| `--filter` | (none) | Regex on instance id |
| `--workers` | `1` | Parallel instances |
| `--output` | `./bench-out/<stamp>` | Trajectories / preds |
| `--dry-run` | | Validate config + API; no HF download / no agent |

## Policy (product)

- Do **not** fold Heavy (4-agent ensemble) into the coding bench harness.
- Leave Tab/FIM alone.
- Lab abliterated models: twin-only; OK for private compare, not product defaults.
- Prefer Podman/Docker on twin for instance sandboxes; OSS compose CPU-only is fine for `dry-run` / `smoke` only.
