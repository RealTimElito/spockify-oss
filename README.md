# agentHub (Spockify)

Homelab stack plus a **Docker Compose** path that runs on Ubuntu, Fedora (SELinux),
and other Linux distros.

## Self-host with Docker

Chat UI, router (`spockify-auto`), LiteLLM, Ollama, SearXNG, Postgres.

```bash
cp .env.example .env    # change secrets
./docker/run.sh         # or ./docker-run.sh — docker compose or podman
```

Open http://localhost:3080 and create the first account (admin).

- Guide (rebuild one service, SELinux, GPU, failures): [docker/README.md](docker/README.md)
- Downloadable kit: GitHub Release `docker-v*` or https://spockify.eu/downloads/spockify-docker.zip
- Pack locally: `make docker-kit` then `./scripts/publish-docker-kit.sh` (downloads host)

NVIDIA GPU: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`

## Open WebUI

Vendored at `services/openwebui/upstream/` — **v0.9.6** + Spockify edits.

- Build/deploy: [services/openwebui/README.md](services/openwebui/README.md)
- **Upgrade / touch-list (stock vs Spockify-only):** [docs/SPOCKIFY_OPENWEBUI_TOUCHLIST.md](docs/SPOCKIFY_OPENWEBUI_TOUCHLIST.md)
- **Desktop IDE (plan):** [docs/SPOCKIFY_DESKTOP_IDE_PLAN.md](docs/SPOCKIFY_DESKTOP_IDE_PLAN.md) — Cursor-like code-oss app; Ghost Monaco stays web-only for now
- **Cursor clone build plan:** [docs/SPOCKIFY_CURSOR_CLONE_BUILD_PLAN.md](docs/SPOCKIFY_CURSOR_CLONE_BUILD_PLAN.md) — parallel agents closing MVP → clone v1

**New features:** prefer `routers/spockify.py`, `/spockify/*` routes, `Spockify*.svelte`, and the router service — not deep stock file edits when avoidable. Do not refactor existing stock patches into modules unless explicitly asked.

## Spockify Desktop IDE

Catalog under [`apps/spockify-ide/`](apps/spockify-ide/) (WS-A shell + Remote SSH). AI extension: `extensions/spockify/` (WS-B/C/D). Shared packages: `packages/spockify-*`.

## Spockify CLI

Claude Code–style terminal agent: [`packages/spockify-cli/`](packages/spockify-cli/) — device link+code login, tool loop (read/edit/grep/shell).

```bash
make build-cli
spockify login          # browser approve → virtual key
spockify "fix the bug"
```

See [packages/spockify-cli/README.md](packages/spockify-cli/README.md). Device routes live in OpenWebUI (`/api/v1/spockify/cli/...`); redeploy OWUI to enable login.

MVP (~9k+ LOC) on code-oss — Cursor-like surfaces thickening overnight; see phase scorecard.

- App README (remote-first AI, P0 SSH, OSS models): [apps/spockify-ide/README.md](apps/spockify-ide/README.md)
- **Cursor clone build plan (parallel agents):** [docs/SPOCKIFY_CURSOR_CLONE_BUILD_PLAN.md](docs/SPOCKIFY_CURSOR_CLONE_BUILD_PLAN.md)
- **Post–clone-v1 roadmap:** [docs/SPOCKIFY_CURSOR_CLONE_ROADMAP.md](docs/SPOCKIFY_CURSOR_CLONE_ROADMAP.md)
- **Phase status (honest scorecard):** [docs/SPOCKIFY_IDE_PHASE_STATUS.md](docs/SPOCKIFY_IDE_PHASE_STATUS.md) — overnight continued (ext **0.5.5**): Apply/checkpoints UX + Agents/Ctrl+K polish retained. Still not full Cursor/Claude Code parity.
- **Phase plans:** [1 Runtime](docs/SPOCKIFY_IDE_PHASE1_RUNTIME_PLAN.md) · [2 UI](docs/SPOCKIFY_IDE_PHASE2_UI_PLAN.md) · [3 Indexing](docs/SPOCKIFY_IDE_PHASE3_INDEXING_PLAN.md) · [4 Composer](docs/SPOCKIFY_IDE_PHASE4_COMPOSER_PLAN.md) · [5 Terminal](docs/SPOCKIFY_IDE_PHASE5_TERMINAL_PLAN.md) · [6 Cloud](docs/SPOCKIFY_IDE_PHASE6_CLOUD_PLAN.md) · [7 Packaging](docs/SPOCKIFY_IDE_PHASE7_PACKAGING_PLAN.md)
- MVP checklist snapshot: [docs/SPOCKIFY_CURSOR_CLONE_CHECKLIST.md](docs/SPOCKIFY_CURSOR_CLONE_CHECKLIST.md)
- AppImage: [apps/spockify-ide/docs/APPIMAGE.md](apps/spockify-ide/docs/APPIMAGE.md)
- Fetch code-oss: [`./scripts/fetch-code-oss.sh`](scripts/fetch-code-oss.sh)
- Remote SSH spike: [apps/spockify-ide/docs/REMOTE_SSH.md](apps/spockify-ide/docs/REMOTE_SSH.md)
