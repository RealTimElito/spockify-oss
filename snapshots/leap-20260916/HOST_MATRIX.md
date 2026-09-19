# Host matrix — Leap 2026-09-16 (LEAP-005 / LEAP-006)

## Roles

| Host | Arch | Allowed jobs | Forbidden |
|------|------|--------------|-----------|
| **Prod Spark** `tim@example.local` ns `spockify` | aarch64 (GB10) | Chat, SPAWN smoke, short canaries, LiteLLM for agent benches via PF | Multi-day SWE storms, wiping Ollama, 48h LEAP-LOOP burn |
| **This workstation** `spock` | **amd64** (`x86_64`) | Docker SWE instance sandboxes, dry-run/smoke client, canary client | Becoming the public chat GPU |
| Lab twin `lab@spark-f1f9.local` | aarch64 | (down this window — override → prod Spark) | — |
| OSS compose | host-dependent | dry-run, docs, unit tests | Pretending CPU compose is coding GPU |

## LiteLLM reachability (LEAP-005)

Agent benches talk to **LiteLLM**, never router chat ports.

| Surface | URL | Role |
|---------|-----|------|
| Compose LiteLLM | `http://127.0.0.1:4000` | Primary local driver |
| Twin LiteLLM NodePort | `http://<twin>:30400` | Lab (when up) |
| Spark LiteLLM | ClusterIP `:4000` — use `kubectl port-forward -n spockify svc/litellm 24001:4000` | Prod inference for short benches (override window) |
| OWUI | `:3080` / `:30080` | Remap to LiteLLM (`run-swebench.sh` does this) |
| **Router** `:4100` / `:30100` | **FORBIDDEN** for `spockify bench` / SWE / lab canary | Chat routing only |

Auth: `LITELLM_MASTER_KEY` / `SPOCKIFY_API_KEY` / `~/.config/spockify/credentials.json`. Do not print secrets into snapshots.

## Docker / Podman decision (LEAP-006)

**Decision: prefer amd64 Docker on this workstation (`spock`) for SWE instance images; use Spark LiteLLM over SSH port-forward for model calls.**

Rationale:

1. Twin aarch64 historically blocked full SWE Docker (qemu pain / pull walls).
2. Prod Spark is also aarch64 — same SWE image problem.
3. This host is `x86_64` with Docker 29.x — correct place for instance sandboxes.
4. Podman not installed on Spark; Docker is present on Spark but wrong arch for most SWE images.

**HOST flag for C6 (LEAP-018):** write `snapshots/leap-20260916/HOST_FLAG` as `HOST-GREEN` only when:

- LiteLLM `/v1/models` reachable from the bench client
- `docker info` succeeds on the sandbox host (amd64)
- Disk < 90%

Else `HOST-BLOCK` / `INFRA-BLOCK`.

## Concurrency

Workers=1 (maybe 2). Never wipe Ollama models between runs. Pin mini-swe-agent version (LEAP-007).
