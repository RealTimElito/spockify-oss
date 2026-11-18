# OpenCode SWE — sqlfluff__sqlfluff-1625

- Outcome: **not-resolved**
- Detail: empty_patch_ids (git diff empty after agent exit)
- Harness: OpenCode `1.18.31` (`opencode run --auto`)
- Model: `gpt-oss-20b` via `spockify-litellm` (LiteLLM OpenAI-compat → Spark `:24001`)
- Commit: `2ba122715d9e9f4a8e4f8e56e4bad5d6cf451cd7`
- Traces: `/workspace/spockify/bench-out/opencode-swe-20261030/opencode.log`
- Wall s: 339
- Same-model row for B-05; not a board %.
- Prior no-`--auto` attempt (~40s) also empty_patch — see `CARD-empty-patch-no-auto.md`.
