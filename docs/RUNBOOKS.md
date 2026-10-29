# Operator runbooks (self-host)

Templates for a **single-tenant workstation or dedicated compose host**. These are
not service-level agreements and not a managed-hosting offering.

Do not put hostnames, emails, or internal addresses on public marketing pages.
Keep those in local operator notes.

## Install and validate

1. Copy `.env.example` to `.env` and replace every placeholder secret.
2. Workstation: `./docker/run.sh` or `make up`.
3. Production profile: `SPOCKIFY_PRODUCTION=1` with
   `SPOCKIFY_API_BIND=127.0.0.1`, `SPOCKIFY_ROUTER_BIND=127.0.0.1`,
   `SPOCKIFY_ISOLATED_RUNNER=bwrap` (or `podman`), `ENABLE_SIGNUP=false`,
   and digest-pinned images (`./docker/record-image-digests.sh`; unpinned
   `:latest` is refused). `./docker/run.sh` fails closed if those are missing.
4. Health: chat UI `/health`, LiteLLM `/health/liveliness` on the bound loopback
   port, router `/health`.
5. First login: create the admin account, then keep signup off.

## Isolated coding runner

Shell and `run_tests` in `@spockify/harness` stay on the host by default
(workstation). With `SPOCKIFY_ISOLATED_RUNNER=bwrap` they run under bubblewrap:
workspace bind, read-only OS trees, no network, `--unshare-pid`, capped `/tmp`
and `ulimit`. `podman` is the optional backend (`SPOCKIFY_ISOLATE_IMAGE`,
`--memory` / `--pids-limit`). Production profile **requires** one of those
flags; missing `bwrap`/`podman` is a hard error at spawn, not a silent fallback.
How to set the flag: [`docs/HARNESS.md`](HARNESS.md#isolated-runner-a-03-incremental).
The production profile writes `$XDG_CONFIG_HOME/spockify/isolation.env`
(override `SPOCKIFY_HOST_ISOLATION_ENV`). The harness merges those keys when
the host process env is unset, so CLI/IDE match compose. Process env still wins.

Each spawn has a `SPOCKIFY_JOB_ID`. The runner never mounts `docker.sock` /
`podman.sock` or the SSH agent. Caps are dropped; network is unshared; bwrap
clears the host environment. Concurrent isolated jobs are capped
(`SPOCKIFY_JOB_MAX`, default 4 / 2 in production). This is still not a
multi-tenant control plane. Supply-chain inventory: `./docker/sbom.sh`
(unsigned CycloneDX). Digest pins: `./docker/record-image-digests.sh`.

Optional per-job uid: `SPOCKIFY_ISOLATE_UID` / `SPOCKIFY_ISOLATE_GID` after the
workspace is writable to that user.

## Backup and restore (compose)

Postgres is the session/user store. Ollama weights and Open WebUI data live
under `STORAGE_ROOT` (default `./data/spockify`).

**Timed restore drill (throwaway container, not prod Spark, not k8s postgres-0):**

```bash
./docker/restore-drill.sh --dry-run
./docker/restore-drill.sh --synthetic --report ./data/spockify
# optional read-only dump from local compose, restore into throwaway:
./docker/restore-drill.sh --dump-compose --report ./data/spockify
```

**Backup (operator, on the compose host):**

```bash
# Postgres logical dump (name the file with local time)
docker compose exec -T postgres pg_dump -U spockify spockify > compose-pg.dump
# Copy STORAGE_ROOT to off-host encrypted storage
```

**Restore (fresh host, same compose files and image tags/digests):**

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U spockify -d spockify < compose-pg.dump
# Restore STORAGE_ROOT, then start the remaining services
```

Rehearse restore before calling the profile production. Timed RTO/RPO is a
pilot agreement, not a published guarantee. Do not run this drill against
a live Kubernetes `postgres-0`.

SLO recording (window starts 2026-10-17; no invented history):
[`docs/G6-SLO.md`](G6-SLO.md). Operator self-host rehearsal (no customer):
[`docs/G8-PILOT.md`](G8-PILOT.md).

## Pin images by digest

Release tags such as `:latest` are for workstation pulls. The production
profile refuses unpinned `:latest`. Record pins from images already on the host:

```bash
./docker/record-image-digests.sh --write .env.pin
# merge SPOCKIFY_*_IMAGE= lines into .env
```

Pin `SPOCKIFY_ROUTER_IMAGE` and `SPOCKIFY_OPENWEBUI_IMAGE` to
`image@sha256:…` (tree builds may keep `:local`). Roll back by restoring the
previous digest. See `docker/README.md`.

## Agent stuck / cancel

Ctrl+C in the CLI, or abort the IDE session. The harness emits `done` with
`reason=cancelled`, persists the JSONL session, and does not treat that as
verified. Resume from the same session id after the process is gone.
