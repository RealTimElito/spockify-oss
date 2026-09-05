# Self-host Spockify with Docker

This is the **supported way** to run Spockify chat (Open WebUI + router + LiteLLM +
Ollama + SearXNG + Postgres) on any Linux distro. The containers are the
portability layer — Ubuntu, Debian, Fedora, and other SELinux hosts included.

**This is not a 100% guarantee.** Compose files validate and the router image
builds; Open WebUI, GPU, and Fedora SELinux have not been end-to-end tested on
every distro in this tree. The **desktop IDE** is a separate GUI container
([docker/ide/README.md](ide/README.md)) — Fedora should use that or Distrobox,
not a host AppImage (FUSE + SELinux).

You can **build from this tree**, **pull published images**, or **download a
compose kit** (GitHub Release or https://spockify.eu/downloads/spockify-docker.zip)
and run without cloning.

## What you get

| Container | Role | Source |
|-----------|------|--------|
| `openwebui` | Chat UI (Spockify fork of Open WebUI) | this repo / GHCR |
| `router` | `spockify-auto` orchestration, search heuristics | this repo / GHCR |
| `litellm` | OpenAI-compatible API + virtual keys | upstream image |
| `ollama` | Local models | upstream image |
| `searxng` | Web search | upstream image |
| `postgres` | Users, chats, LiteLLM tables (separate DB) | upstream image |

Chat UI: **http://localhost:3080**  
API: **http://localhost:4000/v1**  
Router: **http://localhost:4100/health**

Data lives under `./data/spockify/` (override with `STORAGE_ROOT`). Bind mounts
use the `:z` SELinux label so Fedora/RHEL can write them.

## Quick start (git clone — build)

Needs Docker Engine **or** Podman, Compose v2, and ~45 GiB disk for the first
model pull (plus ~20 GiB if you **build** Open WebUI). RAM: 32 GiB comfortable
for Gemma 12B + Codestral. A **16 GiB GPU** can run Devstral Small 2 (Q4, 8k
ctx); do not expect Gemma + Codestral + Devstral all resident at once.

```bash
cp .env.example .env          # change WEBUI_SECRET_KEY and passwords
./docker/run.sh               # detects docker compose vs podman
```

`up` starts the UI, then downloads these Ollama tags in the background (~42 GiB first time):

| Tag | Role |
|-----|------|
| `llama3.2:3b` | Fast greetings / orchestrator |
| `llama3.1:8b` | 8B chat (Llama 3.2 has no 8B; also aliased as `llama3.2:8b`) |
| `gemma4:12b` | Default English chat |
| `codestral` | Code + IDE Tab FIM |
| `devstral-small-2` | Agentic coder (~15 GiB Q4; 8k ctx for 16 GiB VRAM) |

Extra tags: `OLLAMA_PULL_MODELS` in `.env` (space-separated) and matching
`docker/litellm.yaml` entries.

Or by hand:

```bash
docker compose up -d --build   # UI first; ollama-pull continues in the background
```

Open http://localhost:3080 and **create the first account** (it becomes admin).
Then set `ENABLE_SIGNUP=false` in `.env` and `docker compose up -d` again.

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"   # log out and back in
```

NVIDIA GPU (optional):

```bash
# Install NVIDIA driver, then:
# https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

### Fedora / RHEL (SELinux)

Docker CE **or** Podman both work. Compose bind mounts already have `:z`.

```bash
# Podman (default on Fedora)
sudo dnf install -y podman podman-compose
systemctl --user enable --now podman.socket
./docker/run.sh          # pulls GHCR; do not --build unless you change the UI

# or Docker CE
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

`npm run build` inside the Open WebUI image is a heavy Vite compile. Fedora/Podman
often kills it (OOM or Alpine native bindings). `./docker/run.sh` without `--build`
pulls `ghcr.io/<github-owner>/spockify-openwebui` instead. Use `--build` only when
you edited `services/openwebui`.

If a volume is `Permission denied`:

```bash
sudo chcon -Rt container_file_t ./data/spockify
# or: sudo restorecon -Rv ./data/spockify
```

If `getenforce` is `Enforcing` and GPU devices fail:

```bash
sudo setsebool -P container_use_devices on
```

firewalld (only if you expose ports past localhost):

```bash
sudo firewall-cmd --add-port=3080/tcp --permanent && sudo firewall-cmd --reload
```

## Quick start (download kit — no clone)

1. Get **spockify-docker.zip** from GitHub Releases or
   https://spockify.eu/downloads/spockify-docker.zip
2. Unzip, `cp .env.example .env`, fill `SPOCKIFY_ROUTER_IMAGE` and
   `SPOCKIFY_OPENWEBUI_IMAGE` (Release notes list the tags; the zip `.env.example`
   is pre-filled when packed by CI).
3. `./run.sh` (or `docker compose up -d`; no `--build`; models download in the background)

Images are published to GHCR (`ghcr.io/<github-owner>/spockify-router` and
`spockify-openwebui`). If GHCR is blocked, build from git or load a `docker save`
tarball from the same downloads host when provided.

## Prebuilt images from a git checkout

```bash
export SPOCKIFY_ROUTER_IMAGE=ghcr.io/OWNER/spockify-router:latest
export SPOCKIFY_OPENWEBUI_IMAGE=ghcr.io/OWNER/spockify-openwebui:latest
docker compose pull
docker compose up -d
```

## How to change and rebuild one piece

| Change | Rebuild |
|--------|---------|
| Router Python (`services/router/*.py`) | `docker compose build router && docker compose up -d router` |
| Open WebUI (`services/openwebui/upstream/…`) | `docker compose build openwebui && docker compose up -d openwebui` (slow) |
| `docker/litellm.yaml` | `docker compose up -d litellm` (bind-mounted; no image rebuild) |
| `docker/routing-rules.json` or orchestrator prompt | `docker compose up -d router` |
| `.env` secrets / ports | `docker compose up -d` |

CI sets `PRELOAD_MODELS=false` so the Open WebUI image is smaller; Whisper/embed
weights then download into `./data/spockify/openwebui` on first use. Homelab
image builds that still want weights baked in can pass `PRELOAD_MODELS=true`.

## Logs and health

```bash
./docker/run.sh status
./docker/run.sh logs
docker compose logs -f router openwebui litellm
curl -fsS http://localhost:4100/health
curl -fsS http://localhost:4000/health/liveliness
curl -fsS http://localhost:3080/health
```

## Fixing common failures

**`permission denied` on `./data` (Fedora)**  
SELinux. `chcon -Rt container_file_t ./data/spockify` or re-run `./docker/run.sh`
which tries that. Do not disable SELinux.

**Open WebUI: “Server Connection Error” / empty models**  
LiteLLM or router not ready, or the first model pull is still running. Check
`docker compose ps` and `docker compose logs ollama-pull`. `spockify-auto` is
served **via the router** (`docker/litellm.yaml` → `http://router:4100/v1`),
not a raw Ollama tag.

**LiteLLM crash-loop / Prisma**  
LiteLLM uses database `litellm` (created by `docker/postgres-init`). Open WebUI
uses `spockify`. Do not point both at one DB. Do not set
`DISABLE_SCHEMA_UPDATE=true` on a **new** LiteLLM database (first boot must
create tables). After the first successful start you can set it true if you want
to freeze schema.

**Chat works, search does not**  
`docker compose logs searxng`. Settings are `docker/searxng-settings.yml`
(`limiter: false` for compose).

**First signup disabled**  
Empty data dir + `ENABLE_SIGNUP=false` means nobody can register. Set
`ENABLE_SIGNUP=true` once, create the admin, then turn it off.

**GPU ignored**  
CPU compose is the default. Add `-f docker-compose.gpu.yml`. Confirm
`nvidia-smi` on the host and `docker compose exec ollama nvidia-smi`.

**Podman rootless + port bind**  
Use a high port (`SPOCKIFY_CHAT_PORT=3080` is already high). Linger:
`loginctl enable-linger "$USER"`.

**`include:` / `docker-compose.spockify.yml` fails on podman-compose**  
Call `docker-compose.yml` directly (`./docker/run.sh` does). The
`docker-compose.spockify.yml` name is only a Compose v2 include alias.

**Image build OOM / `npm run build` failed (Fedora)**  
Do not rebuild Open WebUI on the laptop. `./docker/run.sh` pulls GHCR. If a
previous `up --build` failed, run without `--build`. The Node stage uses a 4 GiB
heap on Debian, not Alpine; a local build still wants several GiB free RAM.

**Wrong architecture**  
Published CI images are **linux/amd64**. On aarch64 (Raspberry Pi, many
laptops) build locally: `docker compose up -d --build`.

## Adding models

The default pull is `llama3.2:3b`, `llama3.1:8b`, `gemma4:12b`, `codestral`,
and `devstral-small-2`. To pull more on every `up`:

```bash
# .env
OLLAMA_PULL_MODELS="llama3.2:3b gemma3:4b"
```

Add a `model_list` entry in `docker/litellm.yaml` (`ollama_chat/<tag>`) and
`docker compose up -d`. Point router `ORCHESTRATOR_MODEL` at a LiteLLM
**model_name** you defined if you want a stronger orchestrator than `llama3.2-3b`.

One-off: `./docker/run.sh pull-model` or
`docker compose exec ollama ollama pull gemma3:4b`.

Whisper (`base`) and other Open WebUI weights download into
`./data/spockify/openwebui` on first voice/RAG use (`PRELOAD_MODELS=false`).

## IDE Tab

Compose pulls **Codestral** and the router serves native FIM (`GHOST_OLLAMA_FIM_MODEL=codestral`).
In the desktop IDE: Settings → `spockify.baseUrl` = `http://localhost:3080`, then
sign in with the admin account from the chat UI. Tab completions need that local
URL (the default `https://spockify.eu` is the hosted stack).

## Backup

Stop or at least stop Open WebUI/LiteLLM, then copy `STORAGE_ROOT`:

```bash
docker compose stop openwebui litellm
tar -C "${STORAGE_ROOT:-./data/spockify}" -czf spockify-data.tgz postgres openwebui
docker compose start openwebui litellm
```

Ollama weights are large; include `ollama/` only if you want them in the tarball.

## Layout (where to look)

```
docker-compose.yml           # git-clone stack (build + run)
docker-compose.gpu.yml       # NVIDIA overlay
docker/compose.pull.yml      # downloadable kit (images only)
docker/litellm.yaml          # model catalog for compose
docker/routing-rules.json    # router rules (compose service DNS)
docker/run.sh                # docker vs podman, SELinux hint
services/router/             # FastAPI router
services/openwebui/          # Dockerfile + vendored Open WebUI
```

Production Kubernetes is a different operator path and is **not** required for
this compose kit.
