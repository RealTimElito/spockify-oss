# Model dashboard (read-only, local)

Small **Phase 3** operator helper: list the coding catalog and show how to
read live residency via `ollama ps`. This is **not** a cloud hybrid router,
usage/cost product, or live GPU scorecard (G4 stays catalog honesty;
G2 is the signed card path).

## What it shows

1. **Catalog** — promoted vs lab rows from
   `packages/spockify-harness/catalog/coding-models.v1.json`
   (same SoT as [`G4-PROMOTED-MODELS.md`](G4-PROMOTED-MODELS.md) /
   [`CODING_MODELS.md`](CODING_MODELS.md)).
2. **Residency** — whatever `ollama ps` returns on the host or inside the
   Compose Ollama container (NAME, ID, SIZE, PROCESSOR, until).

No `:cloud` tags. No automatic pull/unload. No hybrid cloud fallback.

## Command

```bash
# From repo root (Compose / OSS)
./scripts/model-dashboard.sh
# or
make model-dashboard
```

The script prints the catalog table, then tries in order:

1. Host `ollama ps` (if `ollama` is on `PATH`)
2. `docker` / `podman` exec into a running container whose name contains `ollama`

If nothing is reachable, it prints the manual recipes below and exits 0
(read-only probe — missing Ollama is not a hard failure).

## Read `ollama ps` yourself

Host:

```bash
ollama ps
ollama list
```

Compose (Podman example):

```bash
podman exec "$(podman ps -qf name=ollama | head -1)" ollama ps
podman exec "$(podman ps -qf name=ollama | head -1)" ollama list
```

Compose (Docker):

```bash
docker compose exec ollama ollama ps
```

How to read columns:

| Column | Meaning |
|--------|---------|
| NAME | Loaded tag |
| SIZE | Weights + KV footprint while resident |
| PROCESSOR | GPU vs CPU (or split). `100% CPU` on a GPU host usually means no GPU offload |
| UNTIL | Keep-alive expiry (`Forever` / duration). Empty `ps` = nothing loaded |

`ollama list` is **installed** weights on disk; `ollama ps` is **currently
loaded**. Pins and chat can disagree with the coding catalog — catalog is
policy; `ps` is runtime.

## Out of scope

- Cloud / hybrid routing, cost, tokens/sec product UI
- Pulling, creating, or stopping models (use `make add-model` / Ollama CLI)
- Claiming enterprise model governance or a 30-day usage dashboard (G6)
- Homelab SSH multi-host probes (`make show-models` / `list-models` stay
  private ops helpers)
