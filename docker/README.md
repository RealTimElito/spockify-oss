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

Ollama and Open WebUI data live under `./data/spockify/` (override with
`STORAGE_ROOT`). Those binds use the `:z` SELinux label so Fedora/RHEL can
write them. On Docker, Postgres is also `./data/spockify/postgres`. On Podman,
Postgres is the named volume `spockify_pgdata` — an existing
`./data/spockify/postgres` is unused and is **not** migrated.

## Quick start (git clone — build)

Needs Podman (preferred) **or** Docker Engine, Compose v2, and ~20 GiB disk for the
lean first model pull (plus ~20 GiB if you **build** Open WebUI). RAM: 16 GiB is
enough for `llama3.1:8b` + Codestral. A **16 GiB GPU** can also run Devstral Small 2
(Q4, 8k ctx) if you add it to `OLLAMA_PULL_MODELS`.

```bash
cp .env.example .env          # change WEBUI_SECRET_KEY and passwords
make up                       # or ./docker/run.sh — Podman if present, else Docker
```

`make clean` stops compose leftovers (ports 3080/4000/4100); `make clean CLEAN_DATA=1` or `./docker/clean.sh --data` also wipes `./data` and `spockify_pgdata`.

`./docker/run.sh` uses Podman if `podman compose` or `podman-compose` works. Docker is used only when `docker compose` works **and** `docker info` can reach the daemon (a docker CLI with dockerd down is ignored). Force one with `SPOCKIFY_CONTAINER_ENGINE=docker` or `=podman`.

`up` starts the UI, then downloads these Ollama tags in the background (~20 GiB first time):

| Tag | Role | Typical size |
|-----|------|--------------|
| `llama3.2:3b` | Base for CPU-hot greetings alias | ~2 GiB |
| `llama3.2-3b-cpu` | Fast greetings / orchestrator (CPU, `num_gpu 0`) | ~2 GiB RAM |
| `llama3.1:8b` | Default English chat (8–12 GiB VRAM) | ~4.9 GiB |
| `codestral` | Code + IDE Tab FIM | ~12 GiB |

`ollama-pull` creates **`llama3.2-3b-cpu`** from `config/modelfiles/llama3.2-3b-cpu.Modelfile`
and warms it with `keep_alive=-1` (alias only — not a global forever for every model).
Compose points `FAST_CHAT_WORKER` / orchestrator at that alias so small replies stay on
CPU (~20–25 tok/s on an i9-class host) and free VRAM for 8b/codestral. Verify:
`ollama ps` should show `llama3.2-3b-cpu` at **100% CPU**. Re-warm manually if needed:

```bash
curl -s http://127.0.0.1:11434/api/generate \
  -d '{"model":"llama3.2-3b-cpu","prompt":"warm","stream":false,"keep_alive":-1}'
```

Opt-in (append to `OLLAMA_PULL_MODELS`): `gemma4:12b` (~8 GiB, quality chat),
`devstral-small-2` (~15 GiB Q4; 16 GiB VRAM). Huge opt-in (not for 16 GiB hosts):
`devstral-2` (~75 GiB; Spark/121 GiB class) — also requires a matching
`docker/litellm.yaml` row (already present). Smoke: `OLLAMA_PULL_MODELS=llama3.2:3b`.

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
# Install NVIDIA driver + nvidia-container-toolkit, then:
make gpu   # or: make gpou (typo alias) / ./docker/run.sh --gpu
```

Authorized security demo (GPU + scoped assessment overlay — **not** unfiltered/jailbreak):

```bash
make demo-gpu   # or: ./docker/run.sh --gpu --demo security
```

This mounts `docker/security-demo-prompt.md` and sets `SPOCKIFY_DEMO_PROFILE=security`
so `spockify-auto` treats authorized customer pentests / AD assessments (and
lab hardening) as in-scope; local models only — not jailbreak.
CPU-only: `make demo`.

Docker gets `gpus: all`. On Fedora Podman, `./docker/run.sh --gpu` defaults to
classic `/dev/nvidia*` devices (`.spockify-gpu-devices.generated.yml`) unless CDI
is **proven** resolvable (`nvidia-ctk cdi list` shows `nvidia.com/gpu=all` or
`nvidia.com/gpu=0` **and** a live `podman --device` probe succeeds). File-exists
alone never selects CDI. Forced `SPOCKIFY_PODMAN_GPU=cdi` aborts if unresolvable.

Optional CDI setup (once) if you want the CDI path:

```bash
sudo dnf install -y nvidia-container-toolkit
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
sudo nvidia-ctk runtime configure --runtime=podman
sudo systemctl --user restart podman.socket
nvidia-ctk cdi list   # expect nvidia.com/gpu=all
sudo setsebool -P container_use_devices on
```

`make gpu` / `make gpou` **self-checks** (`nvidia-smi` inside Ollama) and
**self-heals** when possible: on unresolvable CDI, strip CDI and force
`/dev/nvidia*` devices; passwordless `sudo -n` `container_use_devices`; clear
bad `OLLAMA_LLM_LIBRARY=gpu|gpou`. It does not wipe `./data`. If it still fails,
run the printed sudo commands, then `make down && make gpu`.

Confirm GPU inside Ollama:

```bash
# Docker
docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec ollama nvidia-smi
# Podman
podman exec "$(podman ps -qf name=ollama | head -1)" nvidia-smi
# After a short chat: ollama ps → PROCESSOR column should be GPU, not 100% CPU
podman exec "$(podman ps -qf name=ollama | head -1)" ollama ps
```

Lean defaults (`llama3.1:8b` + codestral) fit **8–12 GiB** VRAM. Pulling
`gemma4:12b` / `devstral-small-2` on a smaller card → partial CPU offload and
slow tokens even when `nvidia-smi` works.

### Fedora / RHEL (SELinux)

Docker CE **or** Podman both work. Ollama/Open WebUI binds already have `:z`.
On Podman, Postgres is the named volume `spockify_pgdata` (not a host bind).

```bash
# Podman (default on Fedora)
sudo dnf install -y podman podman-compose
systemctl --user enable --now podman.socket
./docker/run.sh          # pulls GHCR; do not --build unless you change the UI
# If you still see "failed to connect to the Docker API" or docker-compose:
#   systemctl --user enable --now podman.socket
#   podman-compose version   # run.sh uses this, not hyphenated docker-compose

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

#### `Unresolvable cdi devices nvidia.com/gpu=all` (Fedora Podman)

`run.sh` should not hit this anymore: Fedora default is `/dev/nvidia*` unless CDI
verifies. If you forced CDI (`SPOCKIFY_PODMAN_GPU=cdi`) or an old kit still
applied `docker-compose.gpu.podman.yml`, Podman asked for CDI but could not
resolve it.

**Immediate fix (devices — default):**

```bash
make down && make gpu
# or: SPOCKIFY_PODMAN_GPU=devices make gpu
```

**Optional CDI setup** (only if you want CDI after generate):

```bash
sudo dnf install -y nvidia-container-toolkit
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
sudo nvidia-ctk runtime configure --runtime=podman
sudo systemctl --user restart podman.socket
nvidia-ctk cdi list    # expect nvidia.com/gpu=all
sudo setsebool -P container_use_devices on
SPOCKIFY_PODMAN_GPU=cdi make gpu   # aborts if still unresolvable
```

#### `osd_subst_env` / `XDG_CONFIG_HOME not found` (Fedora)

Usually host tooling (CDI / nvidia-ctk env substitution, or another app that
expands `$XDG_CONFIG_HOME`) when those vars are unset. `./docker/run.sh --gpu`
exports sensible XDG defaults before Podman CDI. You can also export them in
your shell and regenerate CDI (commands above).

**Ignore if GPU works:** if `nvidia-smi` inside Ollama succeeds, the warning is
noise — chat can use the GPU. Confirm with the post-`make gpu` check or:

```bash
podman exec "$(podman ps -qf name=ollama | head -1)" nvidia-smi
```

Note: the exact pair `osd_subst_env … XDG_CONFIG_HOME` + `Unknown system '…'`
is also what **MAME** prints (e.g. typo `mame gpou`). That is unrelated to
Spockify compose.

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
3. `make up` or `./run.sh` (or `docker compose up -d`; no `--build`; models download in the background)

Images are published to GHCR (`ghcr.io/<github-owner>/spockify-router` and
`spockify-openwebui`). If GHCR is blocked, build from git or load a `docker save`
tarball from the same downloads host when provided.

## Air-gapped / offline

First `make up` / `make gpu` needs network (pull images + Ollama tags). After that,
the chat UI is meant to work without WAN:

- Compose defaults: `OFFLINE_MODE=true`, version check and community sharing off.
- Fonts and UI assets are local; GhostWriter Monaco is vendored in the Open WebUI image.
- Avatars/citation icons use local `/user.png` / `/favicon.png` (no Gravatar/Google).
- Leave `WEBUI_URL` empty when browsing via a LAN IP; set it only for OAuth/share links.
- TTS defaults to browser voices; set `AUDIO_TTS_ENGINE=edge` only when Microsoft edge-tts is reachable.
- SearXNG / web search degrade offline (empty results); chat to local Ollama via the router still works.
- Whisper / embedding weights must already be in the image or under `STORAGE_ROOT` (first online run caches them when `PRELOAD_MODELS=false`).

Smoke check with WAN blocked on the host (or `podman network disconnect`): open the UI,
sign in, send a short chat — expect a local reply without waiting on CDN/search.

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

**`failed to connect to the Docker API` / `docker-compose --remove-orphans` (Fedora)**  
`make up` prefers `podman-compose`. `podman compose` otherwise shells out to
hyphenated `docker-compose`, which talks to dockerd. Enable the user socket:

```bash
sudo dnf install -y podman podman-compose
systemctl --user enable --now podman.socket
podman-compose version
```

Then `make up` or `./docker/run.sh` again. Do not point compose at `/var/run/docker.sock`.

**`permission denied` on `./data` / pgdata (Fedora)**  
SELinux or a leftover root-owned bind. `./docker/run.sh` uses `:z` on
ollama/openwebui and a named volume for Postgres — it does **not** `chown`.
`chcon -Rt container_file_t ./data/spockify` if SELinux still blocks. Do not
disable SELinux.

**`failed to chown recursively host path .../pgdata` (or ollama / openwebui)**  
That was `:U` or `podman unshare chown` walking a host bind. This tree uses
neither (`:z` only; Postgres is `spockify_pgdata` on Podman). `git pull` and
`make up` again. Old `./data/spockify/postgres` is unused (no auto-migrate).
If a prior `:U` left ollama/openwebui unreadable as your user, once after
pull: `sudo chown -R "$USER:$USER" ./data/spockify/ollama ./data/spockify/openwebui`.
Do not `sudo chown` the Postgres host dir to make `up` work — it is not mounted.

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
CPU compose is the default. Use `make gpu` / `./docker/run.sh --gpu`.
Docker: `gpus: all` + toolkit. Podman: classic `/dev/nvidia*` by default;
CDI (`nvidia.com/gpu=all`) only when list + probe both succeed.
`gpus:` alone is often a no-op. Prefer `podman-compose` (run.sh does). Confirm
`nvidia-smi` **inside** the ollama container and `ollama ps` after a chat.

**`Unresolvable cdi devices nvidia.com/gpu=all`**  
See Fedora section — pull latest `run.sh`; default is devices. Or
`SPOCKIFY_PODMAN_GPU=devices make gpu` when host `/dev/nvidia*` nodes exist.

**`osd_subst_env` / `XDG_CONFIG_HOME not found`**  
See Fedora section — export XDG_* or rely on `run.sh --gpu` defaults; regenerate
CDI if needed. Safe to ignore when container `nvidia-smi` is OK.

**`Unknown system 'gpu'` / invalid `OLLAMA_LLM_LIBRARY`**  
Do not set `OLLAMA_LLM_LIBRARY=gpu` (valid values look like `cuda_v12`, `cpu`).
`run.sh` clears bare `gpu`/`gpou` from the environment. Unrelated: MAME prints
`Unknown system '…'` if you accidentally run the emulator with a bad name.

**Still slow after GPU fix?**
1. Re-run `make gpu` / `make gpou` — it self-checks and self-heals; if it still
   fails, run the printed sudo commands (you are on CPU until then).
2. Check `ollama ps` PROCESSOR: GPU vs 100% CPU. Partial offload still crawls.
3. Stay on lean models: default chat worker is `llama3.1-8b` (no `think=`).
   In the UI leave **Thinking → Off**; avoid Medium/High/Heavy on consumer GPUs.
4. Prefer model `spockify-auto` or `llama3.1-8b` — not a 12B/24B you pulled by hand.
5. Smoke: `OLLAMA_PULL_MODELS=llama3.2:3b ./docker/run.sh --gpu` then chat with
   `llama3.2-3b` / greetings via `spockify-auto`.
6. Web search is chip-gated (not every turn). Heavy = four workers — skip on laptops.

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

One-shot helper (pull + LiteLLM row + restart litellm, keeps data):

```bash
make add-model TAG=llama3.2:3b
make add-model TAG=gemma4:12b AUTO=1      # Auto UI + DEFAULT_CHAT_WORKER
make add-model TAG=gemma4:12b DEFAULT=1   # UI picker default = this model
# MODEL= is an alias for TAG=
```

`model_name` is the tag with `:` → `-` (e.g. `llama3.2:3b` → `llama3.2-3b`).
Duplicates are skipped. Without `AUTO=1` / `DEFAULT=1`, defaults are left alone;
the script prints the next commands.

### Use with spockify-auto

Keep the Open WebUI picker on **Auto** (`spockify-auto`) and only swap the
router English/chat worker:

```bash
make set-chat-worker MODEL=llama3.2-3b
# or TAG=llama3.2:3b  → sanitized to llama3.2-3b
# or after a pull: make add-model TAG=gemma4:12b AUTO=1
```

Writes `.env` (`DEFAULT_MODELS=spockify-auto`, `DEFAULT_CHAT_WORKER=…`, plus
compose light/quality workers) and recreates **router + openwebui** only — no
data wipe. Leaves `FAST_CHAT_WORKER` / orchestrator on the CPU-hot 3b path
unless `MODEL` is explicitly `llama3.2-3b-cpu` or `llama3.2-3b`.

Swap only the Auto **code** worker (`ROOM_CODER_WORKER`, plus
`COMMIT_MESSAGE_WORKER`):

```bash
make set-code-worker MODEL=codestral
# or TAG=devstral-small-2  → sanitized model_name
```

Keeps `DEFAULT_MODELS=spockify-auto` and recreates **router** only. Does not
change chat workers or Tab FIM (`GHOST_OLLAMA_FIM_MODEL`, still codestral by
default).

### Use as UI default

Point the picker at the model itself (Auto remains selectable, but is no longer
the default):

```bash
make add-model TAG=gemma4:12b DEFAULT=1
# sets DEFAULT_MODELS=<model> and DEFAULT_CHAT_WORKER=<model>
```

Prefer `AUTO=1` / `set-chat-worker` when you want routing, search heuristics, and
thinking chips on Auto.

The default pull is `llama3.2:3b`, `llama3.1:8b`, and `codestral`. To pull more
on every `up`:

```bash
# .env — quality chat on 12GB+ VRAM
OLLAMA_PULL_MODELS="llama3.2:3b llama3.1:8b codestral gemma4:12b"
DEFAULT_CHAT_WORKER=gemma4-12b
```

Add a `model_list` entry in `docker/litellm.yaml` (`ollama_chat/<tag>`) and
restart. Point router `ORCHESTRATOR_MODEL` at a LiteLLM **model_name** you
defined if you want a stronger orchestrator than `llama3.2-3b-cpu`.

One-off: `./docker/run.sh pull-model` or
`docker compose exec ollama ollama pull gemma4:12b`.

Whisper (`base`) and other Open WebUI weights download into
`./data/spockify/openwebui` on first voice/RAG use (`PRELOAD_MODELS=false`).

### Custom Ollama tag → LiteLLM → defaults

Any Ollama tag you pull yourself (library, community, or HF-derived) wires the
same way: pull → `docker/litellm.yaml` entry → `.env` defaults → restart.

1. Pull the tag into the running Ollama container:

```bash
# Podman
podman exec "$(podman ps -qf name=ollama | head -1)" ollama pull <exact-ollama-tag>
# Docker
docker compose exec ollama ollama pull <exact-ollama-tag>
```

2. Add a LiteLLM row in `docker/litellm.yaml` (`model_name` is the Spockify id;
   `ollama_chat/…` must match the exact Ollama tag). Then set the same
   `model_name` in `.env` (or restart after editing):

```yaml
  - model_name: my-custom
    litellm_params:
      model: ollama_chat/<exact-ollama-tag>
      api_base: http://ollama:11434
```

3. Point defaults at that `model_name` as needed:

```bash
# Prefer Auto + worker (or: make set-chat-worker MODEL=my-custom)
DEFAULT_MODELS=spockify-auto
DEFAULT_CHAT_WORKER=my-custom             # spockify-auto English worker
# FAST_CHAT_WORKER=my-custom              # only if you intend to replace CPU-hot 3b
# ORCHESTRATOR_MODEL=my-custom            # routing planner

# Or UI picker default (or: make add-model TAG=… DEFAULT=1)
# DEFAULT_MODELS=my-custom
# DEFAULT_CHAT_WORKER=my-custom
```

4. Pick up config:

```bash
make set-chat-worker MODEL=my-custom   # preferred: recreate router + openwebui
make set-code-worker MODEL=my-custom   # Auto code routes → ROOM_CODER_WORKER
# or: make down && make gpu            # full restart
```

`litellm.yaml` is bind-mounted; `.env` worker vars need a compose recreate.
VRAM must fit the tag (lean laptop vs large-memory / Spark-class hosts). First
pull needs network once; air-gapped chat works afterward if weights are already
local.

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

On Podman, Postgres is the named volume `spockify_pgdata`, not
`./data/spockify/postgres`. Export that volume instead of the host dir:

```bash
podman volume export spockify_spockify_pgdata -o pgdata.tar
```

(`podman volume ls | grep pgdata` if the name differs.)

Ollama weights are large; include `ollama/` only if you want them in the tarball.

## Layout (where to look)

```
docker-compose.yml           # git-clone stack (build + run)
docker-compose.gpu.yml       # NVIDIA overlay (Docker Compose gpus=all)
docker-compose.gpu.podman.yml # Podman CDI (only if proven resolvable)
docker-compose.gpu.podman.devices.yml # Podman classic /dev/nvidia* (Fedora default)
docker-compose.podman.yml    # Podman: named pgdata + :z binds (no :U)
docker/compose.pull.yml      # downloadable kit (images only)
docker/litellm.yaml          # model catalog for compose
docker/routing-rules.json    # router rules (compose service DNS)
docker/run.sh                # podman preferred, else docker; SELinux hint
services/router/             # FastAPI router
services/openwebui/          # Dockerfile + vendored Open WebUI
```

Production Kubernetes is a different operator path and is **not** required for
this compose kit.
