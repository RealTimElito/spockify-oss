# agentHub (Spockify)

Homelab stack plus a **Docker Compose** path that runs on Ubuntu, Fedora (SELinux),
and other Linux distros.

## Get Started

Local compose, desktop IDE, and CLI.

### 1. Chat (Docker Compose)

Ubuntu / Fedora:

```bash
cp .env.example .env    # change secrets
make up                 # GHCR pull, no local Vite; or ./docker/run.sh
```

Uses Podman if compose works, else Docker (only if the daemon is up). Fedora “Docker API” errors: `systemctl --user enable --now podman.socket` and `podman compose version` (or `podman-compose`). Force Docker with `SPOCKIFY_CONTAINER_ENGINE=docker`.

Open http://localhost:3080 — first account is admin.

GPU: `make gpu` or `./docker/run.sh --gpu`.

Details: [docker/README.md](docker/README.md). Fedora: do not `--build` Open WebUI; `make up` pulls GHCR.

### 2. Spockify IDE

Desktop IDE in a container. Fedora: prefer this or Distrobox, not a host AppImage.

```bash
./docker/ide/run.sh --build   # first time: downloads the published AppImage
make ide                      # ./docker/ide/run.sh
```

`--build` fetches the AppImage from https://spockify.eu/downloads/ unless you drop one in `docker/ide/payload/`. Needs a graphical session.

Details: [docker/ide/README.md](docker/ide/README.md).

### 3. CLI

```bash
make build-cli
spockify login          # browser approve → virtual key
```

See [packages/spockify-cli/README.md](packages/spockify-cli/README.md).

Pack a compose kit: `make kit` (alias `make docker-kit`).

## Self-host with Docker

Chat UI, router (`spockify-auto`), LiteLLM, Ollama, SearXNG, Postgres.

```bash
cp .env.example .env    # change secrets
make up                 # or ./docker/run.sh / ./docker-run.sh — Podman if compose works, else Docker if the API is up
```

Open http://localhost:3080 and create the first account (admin).

- Guide (rebuild one service, SELinux, GPU, failures): [docker/README.md](docker/README.md)
- Downloadable kit: GitHub Release `docker-v*` or https://spockify.eu/downloads/spockify-docker.zip
- Pack locally: `make kit` (alias `make docker-kit`)

NVIDIA GPU: `make gpu` or `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`

## Open WebUI

Vendored at `services/openwebui/upstream/` — **v0.9.6** + Spockify edits.

- Build/deploy: [services/openwebui/README.md](services/openwebui/README.md)

**New features:** prefer `routers/spockify.py`, `/spockify/*` routes, `Spockify*.svelte`, and the router service — not deep stock file edits when avoidable. Do not refactor existing stock patches into modules unless explicitly asked.

## Spockify Desktop IDE

AI extension: `extensions/spockify/`. Shared packages: `packages/spockify-*`.

This public tree does not ship the `apps/spockify-ide` code-oss catalog. Run the published IDE in a container: `make ide` — [docker/ide/README.md](docker/ide/README.md).

## Spockify CLI

Claude Code–style terminal agent: [`packages/spockify-cli/`](packages/spockify-cli/) — device link+code login, tool loop (read/edit/grep/shell).

```bash
make build-cli
spockify login          # browser approve → virtual key
spockify "fix the bug"
```

See [packages/spockify-cli/README.md](packages/spockify-cli/README.md). Device routes live in OpenWebUI (`/api/v1/spockify/cli/...`); redeploy OWUI to enable login.

MVP on code-oss — Cursor-like surfaces, not full Cursor/Claude Code parity.

- Container IDE: [docker/ide/README.md](docker/ide/README.md)
- CLI: [packages/spockify-cli/README.md](packages/spockify-cli/README.md)
- Chat UI: [services/openwebui/README.md](services/openwebui/README.md)
