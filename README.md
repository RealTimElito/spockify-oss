# Spockify

Self-hosted, OSS-model AI stack: a chat UI, a smart model router, web search, and
an editor/CLI toolchain — all running on open models via [Ollama](https://ollama.com)
and [LiteLLM](https://github.com/BerriAI/litellm). No proprietary model APIs required.

Spockify wires together:

- **Chat UI** — an [Open WebUI](https://github.com/open-webui/open-webui) fork with
  Spockify UX (Canvas side panel, hybrid TTS, router attribution).
- **Router** (`services/router`) — the `spockify-auto` orchestrator: picks a worker
  model per request, decides when to search, and streams the answer back.
- **LiteLLM** — OpenAI-compatible proxy in front of Ollama (and optionally vLLM).
- **SearXNG** — private metasearch the router uses for grounded answers.
- **Editor + CLI** — a VS Code-style extension (`extensions/spockify`), shared
  client packages (`packages/spockify-*`), and a terminal agent
  (`packages/spockify-cli`).

## Quick start (Docker Compose)

Requirements: Docker with the Compose plugin. A GPU is optional (CPU works for
small models).

```bash
git clone <your-fork-url> spockify && cd spockify
cp .env.example .env        # then edit the secrets
docker compose up -d        # builds the router, pulls everything else
```

Pull at least one model so the router has a worker:

```bash
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull gemma3:12b   # optional, better quality
```

Create the first admin: set `ENABLE_SIGNUP=true` in `.env`, `docker compose up -d`,
register at http://localhost:3000, then set `ENABLE_SIGNUP=false` and bring it up
again.

Open http://localhost:3000 and chat with the `spockify-auto` model.

### Services and ports

| Service   | Port  | Purpose                                  |
|-----------|-------|------------------------------------------|
| openwebui | 3000  | Chat UI                                  |
| router    | 4100  | `spockify-auto` orchestrator             |
| litellm   | 4000  | OpenAI-compatible model proxy            |
| ollama    | 11435 | Local model runtime                      |
| searxng   | 8888  | Private web search                       |
| postgres  | 5433  | Chat/user/config storage                 |

## Configuration

- Model list and routing targets: [`config/litellm-dev.yaml`](config/litellm-dev.yaml)
- Router prompt and rules: [`config/orchestrator-prompt.md`](config/orchestrator-prompt.md),
  [`config/routing-rules.json`](config/routing-rules.json)
- Search settings: [`config/searxng-settings-dev.yml`](config/searxng-settings-dev.yml)
- All secrets and paths come from `.env` — see [`.env.example`](.env.example).

Data persists under `STORAGE_ROOT` (default `./data/spockify`).

## GPU

The `ollama` service is CPU-only by default. To use an NVIDIA GPU, install the
NVIDIA Container Toolkit and uncomment the `deploy:` block under `ollama` in
[`docker-compose.yml`](docker-compose.yml).

## Building the images

The router builds automatically from [`services/router`](services/router) on
`docker compose up`. The default chat UI is stock Open WebUI renamed to Spockify
at runtime. To run the full Spockify Open WebUI fork instead:

```bash
docker compose -f docker-compose.yml -f docker-compose.fork.yml up -d --build
```

To publish images to your own registry, enable the CI workflow shipped under
[`.github/workflows-disabled/`](.github/workflows-disabled/) (see its README for
the one-step move into `.github/workflows/`).

## Project layout

```
services/router/        spockify-auto orchestrator (FastAPI)
services/openwebui/     Open WebUI fork (vendored upstream + Spockify edits)
services/tab-train/     optional: tab-completion model training utilities
services/spockify-mcp/  optional: MCP server for cluster ops
extensions/spockify/    VS Code-style AI extension
packages/spockify-*/    shared client, CLI, codebase-index, model helpers
config/                 model, routing, and search configuration
sql/migrations/         Spockify database migrations
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

Spockify-authored code is released under the [MIT License](LICENSE).

The vendored Open WebUI under `services/openwebui/upstream/` retains its own
upstream license — see
[`services/openwebui/upstream/LICENSE`](services/openwebui/upstream/LICENSE).

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).
