# G4 promoted-model deck

Source of truth: `packages/spockify-harness/catalog/coding-models.v1.json`
(mirrored by `CODING_CATALOG_V1` and `catalog/promoted-deck.v1.json`).
This is a catalog honesty check, not a live GPU scorecard (G2) and not a
SWE % claim. Phase 5 stays **Partial**.

Chat Auto and coding Auto stay `spockify-auto`. No `:cloud` / cloud API tags.

Stated hardware for this deck: a single-tenant ~120Gi unified-memory NVIDIA
workstation. `num_ctx` is copied from existing metadata only: Ollama
`/api/show` `gpt-oss.context_length` (131072) for the gpt-oss pins, and
LiteLLM `litellm_params.num_ctx` (262144) for the Qwen 3.8 row. That is not a
GPU-measured working set. Auto/coding default stays `gpt-oss-20b` think=off
(`DEFAULT_SESSION_PIN`). Catalog does **not** inject `num_ctx` on gpt-oss
requests (Ollama default stands); LiteLLM already sends it for Qwen 3.8.
Lab/eval rows stay unpinned (no source in-tree). Tools and streaming are local
OpenAI-compatible Ollama / LiteLLM. Image and video checkpoints are outside
this deck.

## Promoted (prod pins)

| Id | Auto | Tools | Stream | Context | Think | Notes |
|----|------|-------|--------|---------|-------|-------|
| `gpt-oss-20b` | yes (default) | yes | yes | 131072 (Ollama `gpt-oss.context_length`; request not injected) | off/low/medium/high | Default Auto worker |
| `gpt-oss-120b` | yes | yes | yes | 131072 (Ollama `gpt-oss.context_length`; request not injected) | off/low/medium/high | Auto may pick; evicted by user `devstral-2` |
| `qwen3.8-flash-next-ud-UD-Q3_K_XL` | **no** | yes | yes | 262144 (LiteLLM `num_ctx`) | off/low/medium/high | Explicit prod only |

Coding `think_allowed` has **no** `heavy`. Heavy is a chat ensemble, not a
coding harness.

## Lab-only (`promoted: false`)

| Id | Pool | Auto | Think | Notes |
|----|------|------|-------|-------|
| `devstral-small-2` | lab | never | off (omit think=) | Unpublished |
| `devstral-2` | lab | never | off (omit think=) | Evicts 120b-hot |
| `qwen3-coder-30b-a3b` | eval | never | listed, omitted at runtime | Instruct Q4/Q8; not on public prod API |

`spockify model lab` lists these. It does not promote them. Promote stays a
no-op until a fixture CARD exists.

## Auto

- Id: `spockify-auto` (aliases `auto`, `*-auto`).
- Session picker returns `{model, think}` only.
- Default: `gpt-oss-20b` think=off.
- Auto may resolve only to `gpt-oss-20b` or `gpt-oss-120b`.
- After the first write, the worker is frozen.

## Not in this deck

- Chat-only workers (Gemma, Llama, Magistral, …) are router catalog rows, not
  coding promotions.
- Image / video Comfy checkpoints.
- Cloud / `:cloud` tags (forbidden as product defaults).
