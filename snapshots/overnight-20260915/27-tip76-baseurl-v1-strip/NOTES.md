# 27 — tip 76 strip trailing /v1 on lab base URL

`--base-url …/v1` previously hit `/v1/v1/chat/completions` (404).
`resolve_base_url` now strips a trailing `/v1` after OWUI→LiteLLM remap.
