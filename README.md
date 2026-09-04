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

Requirements: Docker Compose v2 or Podman. Ubuntu/Debian and Fedora/SELinux
are the tested distros. A GPU is optional (CPU works for small models).

```bash
git clone <your-fork-url> spockify && cd spockify
cp .env.example .env        # then edit the secrets
./docker/run.sh             # builds, starts, and pulls llama3.2:3b (~2 GiB)
```

Or `docker compose up -d --build` — same model pull happens automatically.
Extra tags: `OLLAMA_PULL_MODELS` in `.env` (and a matching `docker/litellm.yaml`
entry). Full guide: [docker/README.md](docker/README.md).

Create the first admin at http://localhost:3080, then set `ENABLE_SIGNUP=false`
and `docker compose up -d` again.

### Services and ports

| Service   | Port  | Purpose                                  |
|-----------|-------|------------------------------------------|
| openwebui | 3080  | Chat UI                                  |
| router    | 4100  | `spockify-auto` orchestrator             |
| litellm   | 4000  | OpenAI-compatible model proxy            |

## Configuration

- Model list and routing targets: [`config/litellm-dev.yaml`](config/litellm-dev.yaml)
- Router prompt and rules: [`config/orchestrator-prompt.md`](config/orchestrator-prompt.md),
  [`config/routing-rules.json`](config/routing-rules.json)
- Search settings: [`config/searxng-settings-dev.yml`](config/searxng-settings-dev.yml)
- All secrets and paths come from `.env` — see [`.env.example`](.env.example).

Data persists under `STORAGE_ROOT` (default `./data/spockify`).

## GPU

CPU compose is the default. NVIDIA:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

## Building the images

The router and Open WebUI fork build from this tree on `docker compose up`.
Prebuilt images: `ghcr.io/<owner>/spockify-router` (and `spockify-openwebui`
when published). Compose kit zip: https://spockify.eu/downloads/spockify-docker.zip

CI: [`.github/workflows/docker-images.yml`](.github/workflows/docker-images.yml).

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
