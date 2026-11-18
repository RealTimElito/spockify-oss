# Spockify remote API — authentication, search, rate limits, CORS

OpenAI-compatible API at `https://spockify.eu/v1`.

**Base URL:** set client `base_url` / `OPENAI_BASE_URL` to `https://spockify.eu/v1` (include the `/v1` suffix). Using `https://spockify.eu` alone routes most paths to the chat UI, not the API.

## Authentication

All requests require a Bearer token:

```bash
export SPOCKIFY_API_KEY="$(make -s api-key)"
curl -sS https://spockify.eu/v1/models \
  -H "Authorization: Bearer ${SPOCKIFY_API_KEY}"
```

### Key types

| Key | Source | Use |
|-----|--------|-----|
| Master key | `spockify-secrets` / `make api-key` | Admin, all models, search |
| Virtual keys | Admin UI → Keys (`/ui`) | Per-client scoped access (recommended for remote) |

Create virtual keys after deploy:

```bash
make port-forward-api   # http://localhost:4000
# Admin UI: https://spockify.eu/ui/  (master key login)
# API: POST https://spockify.eu/key/generate  (Bearer master key)
```

| URL | Purpose |
|-----|---------|
| `https://spockify.eu/ui/` | Spockify admin dashboard (virtual keys, teams, spend; nginx rewrites LiteLLM chrome to Spockify) |
| `POST https://spockify.eu/key/generate` | Create virtual keys via API |
| `https://spockify.eu/sso/key/generate` | SSO login entry (only when SSO is configured) |
| `https://spockify.eu/fallback/login` | Username/password login when SSO is enabled |

Do **not** use `/sso/key/generate` to create keys — despite the name, it is LiteLLM's SSO login redirect URL, not the key-generation API.

Store client keys outside the cluster. Rotate via admin UI or recreate secrets.

### CLI device login (link + code)

The Spockify CLI (`packages/spockify-cli`) can mint a virtual key without pasting secrets:

1. `spockify login` → `POST /api/v1/spockify/cli/device/code`
2. Open `/api/v1/spockify/cli/activate`, sign in, enter the user code, Approve
3. CLI polls `POST /api/v1/spockify/cli/device/token` until it receives `access_token` (LiteLLM `sk-…`)

Approval requires an OpenWebUI session; the server calls LiteLLM `POST /key/generate` with the master key.

### Chat account key

Signed-in approved users (role `user`, `admin`, `family`, or `guest` — not `pending`) can mint the same kind of virtual key from **Settings → Account → API key**. The server stores it for that user and calls LiteLLM `POST /key/generate` (90 days, `user_id` set to the chat user). Revoke calls LiteLLM `POST /key/delete`. This is not the master key and does not grant the LiteLLM admin UI.

## Models

| Model | Behavior |
|-------|----------|
| `spockify-auto` | Gemma 4 orchestrator → SearXNG (if needed) → worker model |
| `spockify-room` | Multi-agent: researcher + coder + critic (sequential labeled turns) |
| `spockify-agents` | Parallel multi-agent workers (max 4) + synthesis |
| `codestral` | Code generation (no automatic search) |
| `web-codestral` | Codestral + `litellm_web_search` tool interception |
| `web-gemma` | Gemma 4 + web search |
| `web-llama` | Fast chat + web search |
| `orchestrator` | Routing JSON only (Gemma 4) |

See `config/tools/models-web-search.yaml` for the full web-search allowlist.

## Chat completions

```bash
curl -sS https://spockify.eu/v1/chat/completions \
  -H "Authorization: Bearer ${SPOCKIFY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "spockify-auto",
    "messages": [{"role": "user", "content": "What changed in Python 3.13 typing?"}]
  }'
```

Orchestrated responses include an `spockify` metadata block with routing and search info.

## Web search API

Direct search (no LLM) via self-hosted SearXNG:

```bash
curl -sS https://spockify.eu/v1/search/spockify-searxng \
  -H "Authorization: Bearer ${SPOCKIFY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "FastAPI lifespan middleware", "max_results": 5}'
```

MCP-style OpenAPI spec: `config/tools/mcp/search-tool.openapi.yaml`

### Tool calling (API clients)

Pass the web search tool to `web-*` models (tool name is fixed by the proxy layer):

```json
{
  "model": "web-codestral",
  "messages": [{"role": "user", "content": "Latest SQLAlchemy 2.0 async patterns"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "litellm_web_search",
      "description": "Search the web",
      "parameters": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"]
      }
    }
  }]
}
```

Spockify executes search server-side via SearXNG.

## CORS

Configured in `config/litellm.yaml` under `general_settings`:

```yaml
cors_allow_origins:
  - "https://spockify.eu"
cors_allow_credentials: false
cors_allow_methods: ["GET", "POST", "OPTIONS"]
cors_allow_headers: ["Authorization", "Content-Type", "X-Request-ID"]
```

Add your client origin before exposing to browser apps:

```yaml
cors_allow_origins:
  - "https://spockify.eu"
  - "https://my-app.example.com"
```

Redeploy after config changes (`make deploy`).

## Rate limits (skeleton)

Per-deployment limits in `config/litellm.yaml`:

```yaml
model_list:
  - model_name: codestral
    litellm_params:
      rpm: 60
      tpm: 90000
```

Enable enforcement (requires Redis for multi-replica):

```yaml
router_settings:
  optional_pre_call_checks: ["enforce_model_rate_limits"]
```

Virtual-key budgets: admin UI → Keys → set `max_budget`, `rpm_limit`, `tpm_limit`.

Global caps in `general_settings` (uncomment when ready):

```yaml
general_settings:
  max_parallel_requests: 10
  global_max_parallel_requests: 100
```

## API docs (Swagger)

Spockify OpenAPI docs at `https://spockify.eu/docs` (ReDoc: `/redoc`).

Protected with HTTP basic auth at the ingress layer:

| Field | Value |
|-------|-------|
| URL | `https://spockify.eu/docs` |
| Username | `admin` |
| Password | Same as master API key (`make api-key`) |

```bash
export SPOCKIFY_API_KEY="$(make -s api-key)"
curl -sS -u "admin:${SPOCKIFY_API_KEY}" https://spockify.eu/openapi.json | head
```

OpenAPI title: **Spockify API**. Swagger server URL: `https://spockify.eu` (paths in the spec already include `/v1/...`, so Try it out hits `https://spockify.eu/v1/models` etc.).

### Swagger Bearer auth (Try it out)

LiteLLM's default OpenAPI spec uses `x-litellm-api-key`, but Spockify expects `Authorization: Bearer`. The ingress injects `BearerAuth` (`http` / `bearer`) into `/openapi.json` so Swagger UI sends the correct header.

1. Open `https://spockify.eu/docs` (HTTP basic auth: user `admin`, password = master API key).
2. Click **Authorize** (top right).
3. Enter your API key in **BearerAuth** — paste the key only (`sk-...`), or `Bearer sk-...` (Swagger strips a redundant `Bearer ` prefix).
4. Click **Authorize**, then **Close**.
5. **Try it out** on `GET /v1/models` — the generated curl includes `-H 'Authorization: Bearer ...'`.

Auth is persisted in the browser session (`persistAuthorization: true`).

For manual `curl` and SDK clients, set base URL to `https://spockify.eu/v1` — that is separate from the OpenAPI `servers` entry above.

Unauthenticated requests return `401`. Open WebUI does not expose `/docs` in production (`ENV=prod`).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `No api key passed in` on `/v1/*` | Missing `Authorization: Bearer` header | Add header; key from `make -s api-key`; in Swagger click **Authorize** first |
| HTML instead of JSON on `/models` | Base URL missing `/v1` | Use `https://spockify.eu/v1` as base URL |
| `401 Authorization Required` on `/docs` | HTTP basic auth required | `curl -u admin:$SPOCKIFY_API_KEY` |
| `401` on `/docs` with basic auth | Docs password out of sync with master key | Run `ensure-spockify-api-docs-auth.sh` on Spark |
| `404 {"detail":"Not Found"}` on `/v1/foo` | Unknown API path | Use paths from `/openapi.json` (e.g. `/v1/models`, `/v1/chat/completions`) |
| `404` on `/v1/v1/models` | Double `/v1` in URL | Swagger `servers` URL must be `https://spockify.eu` (not `/v1`); SDK base URL stays `https://spockify.eu/v1` |

Ingress routes on Spark (no path stripping — LiteLLM receives full paths):

| Public path | Backend |
|-------------|---------|
| `/v1/*` | litellm |
| `/models`, `/chat/completions`, … | litellm (compat without `/v1`) |
| `/ui`, `/docs`, `/openapi.json` | litellm |
| `/` | openwebui (chat UI) |

## Internal services (not on ingress)

| Service | URL (in-cluster) | Public |
|---------|------------------|--------|
| SearXNG | `http://searxng:8080` | No |
| Router | `http://spockify-router:4100` | No |
| Spockify API | `http://litellm:4000` | Yes (`/v1`, `/ui`, `/docs` with basic auth) |

Admin UI backend APIs (`/key/*`, `/sso/*`, `/team/*`, …) are routed to LiteLLM via `spockify-spark-litellm-ui-api-ingress.yaml` so they do not hit the Open WebUI catch-all (`/`).

SearXNG is cluster-internal only. External clients use `/v1/search/spockify-searxng` or `spockify-auto`.

## Chat UI TTS (OpenWebUI)

Read aloud / Call mode use OpenWebUI `POST /api/v1/audio/speech` with a JSON body (Edge Neural, no paid key). Auto voices: Sofie (Swedish), Ava Multilingual (English). Not part of the LiteLLM `/v1` API.

Voice clone uses the same path and the same Bearer key. Send multipart `input` plus a `speaker_wav` stem (or `model=xtts` / `voice=clone`). Optional `language` and `response_format` (`mp3` or `wav`; default `mp3`). If a stem or clone model was requested and the clone sidecar is down, the route returns **503** and does not substitute an Edge voice. Requests with no stem still use Edge.

`GET /api/v1/audio/models` lists `edge-tts` and `xtts` (`voice=clone`).

```bash
curl -H "Authorization: Bearer $KEY" \
  -F "input=I can fix it!" \
  -F "language=en" \
  -F "speaker_wav=@ref.wav;type=audio/wav" \
  -o frank_clone.mp3 \
  https://spockify.eu/api/v1/audio/speech
```

## LabRats production (router)

Episode voice, silent Layout plates, and dialogue mux live on the router, not on the Open WebUI read-aloud route above. The frozen path, curls, and accept checks are in [LABRATS_PRODUCTION.md](LABRATS_PRODUCTION.md).

`POST /v1/audio/speech` with a `speaker_id` that has a dry stem is XTTS only (503 if the CPU sidecar is down; Edge is not substituted). Dialogue is a silent Layout plate plus `POST /v1/videos/mux`. That mux puts the VO on the timeline. It is not lip-sync.

## Local development

```bash
make dev-up
export SPOCKIFY_API_KEY=sk-spockify-dev
curl -sS http://localhost:4000/v1/models -H "Authorization: Bearer ${SPOCKIFY_API_KEY}"
curl -sS http://localhost:8888/search?q=test&format=json   # SearXNG direct (dev only)
```

## Security checklist

- [ ] Use virtual keys per client, not the master key
- [ ] Restrict `cors_allow_origins` to known domains
- [ ] Enable `router_settings.optional_pre_call_checks` when Redis is available
- [ ] Rotate master API key in `spockify-secrets` periodically
- [ ] Keep SearXNG off public ingress (default)
- [ ] Review usage logs in Postgres / admin UI

## IDE embeddings + sync (Phase 3 / 6)

| Route | Status | Notes |
|-------|--------|-------|
| `POST /v1/embeddings` | **Live** on Spark (`nomic-embed` / `mxbai-embed`, dim 768) | IDE `ModelTransport.embed()`; catalog in LiteLLM. Proof: `packages/spockify-codebase/test/live-nomic-hybrid.test.ts` with `SPOCKIFY_API_KEY`. Falls back to local hash vectors if unavailable. |
| `GET/PUT /api/v1/spockify/ide/sync` | **Live** (OWUI, image `ide-sync-20260720`+) | Auth required. Body `{ etag, payload }` / PUT `{ payload }`. ETag via `If-None-Match` / `If-Match` (304 / 412). No plaintext API keys. Client 404 → local-only. |
| `GET/PUT /api/v1/spockify/ide/index` | **Live** (OWUI, image `ide-index-20260720`) | Auth required. **Metadata only** (fingerprint, chunk/vector counts, embed model). Query `workspace_key`; PUT `{ workspace_key, payload }`. Rejects `chunks`/`vectors`/secrets. Cap 64KB. |
| `GET /api/v1/spockify/ide/appimage/latest.json?arch=x86_64\|aarch64` | **Live** (OWUI, image `ide-appimage-20260720`+) | Public. Returns `{ version, downloadUrl, sha256 }`. `x86_64` published; `aarch64` → 404 until hosted. Artifact: `https://spockify.eu/downloads/Spockify-IDE-…AppImage` (also Exact root path). |
| `GET /downloads/spockify-ide-reh-linux-{x64\|arm64}-{commit}.tar.gz` | **Live** (downloads nginx) | Public REH for Remote SSH. Built by `apps/spockify-ide/scripts/build-reh.sh`, published with `scripts/publish-ide-reh.sh`. Client template: `https://spockify.eu/downloads/spockify-ide-reh-${os}-${arch}-${commit}.tar.gz`. See `apps/spockify-ide/docs/REMOTE_SSH.md`. |
| Full cloud **vector / chunk** sync | **Deferred** | Overnight risk: multi‑MB payloads, new durable store, web blast radius. Keep local Lance + nomic; additive APIs later with size limits, per-user paths, backup + `maxUnavailable: 0`, verify users/chats. |

