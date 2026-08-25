# Spockify MCP

Read-only MCP tools for Spockify cluster operations. Targets **Cursor IDE** (stdio) and **Cursor Cloud Agents** (HTTP behind a tunnel).

Phase 1 tools wrap existing `make` / shell scripts with timeouts and secret redaction. There is no generic shell tool.

## Tools

| Tool | Backing command |
|------|-----------------|
| `spockify_cluster_status` | `make status` |
| `spockify_tab_train_status` | `scripts/tab-train-status.sh` / `make tab-train-status` |
| `spockify_tail_logs` | `kubectl logs -l app=…` (openwebui, router, ollama, vllm, litellm) |
| `spockify_health` | `curl` router `/health` and `/spockify/status` |
| `spockify_preflight` | `make preflight-deploy` |

## Install (local)

From the repo root:

```bash
cd services/spockify-mcp
pip install -e '.[dev]'
# or: uv pip install -e '.[dev]'
```

## Local Cursor setup

Project MCP config lives at [`.cursor/mcp.json`](../../.cursor/mcp.json). After pull, restart Cursor (or reload window).

The server runs via:

```bash
python -m spockify_mcp.server
```

Environment (optional):

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENTHUB_ROOT` | auto-detect | Repo root for `make` |
| `SPARK_HOST` / `DEST_HOST` | `user@your-cluster-host` | SSH target when local kubectl unavailable |
| `NAMESPACE` | `spockify` | Kubernetes namespace |
| `KUBECTL` | `microk8s kubectl` | Local kubectl command |
| `ROUTER_HEALTH_URL` | `http://spockify-router.spockify.svc.cluster.local:4100` | Router base URL |

Host detection: the cluster host uses local kubectl; dev machines fall back to SSH.

### Smoke test

```bash
cd services/spockify-mcp
python -m unittest discover -s tests -v
python -c "from spockify_mcp.runner import cluster_status; print(cluster_status()[:500])"
```

In Cursor Agent chat, confirm tools like `spockify_cluster_status` appear under the **spockify** MCP server.

## Cloud Agents (HTTP)

Cloud Agents reach your cluster through a **remote HTTP MCP** endpoint (Streamable HTTP at `/mcp`).

1. On the cluster host (or a host with kubectl + repo checkout):

   ```bash
   export SPOCKIFY_MCP_TOKEN="$(openssl rand -hex 32)"   # store securely, not in git
   export SPOCKIFY_MCP_HTTP=1
   export AGENTHUB_ROOT=/path/to/agentHub
   ./scripts/run-spockify-mcp-http.sh
   ```

   Or manually:

   ```bash
   python -m spockify_mcp.server --http --host 0.0.0.0 --port 8787
   ```

2. Expose port **8787** via SSH tunnel, Tailscale, or ingress (TLS recommended).

3. In **Cursor Dashboard → Integrations & MCP**, add a server:

   - **URL:** `https://your-tunnel-host/mcp` (FastMCP default path)
   - **Headers:** `Authorization: Bearer <SPOCKIFY_MCP_TOKEN>`

`SPOCKIFY_MCP_TOKEN` is **required** in HTTP mode. Without it the process exits on startup.

## Security

- **No secrets in git.** Use env vars or a local secret file outside the repo.
- Tool output is passed through **redaction** (Bearer tokens, API keys, `LITELLM_MASTER_KEY`, long base64 blobs). Redaction is best-effort — still avoid dumping raw Secrets.
- HTTP mode must not be exposed without TLS and a strong bearer token.
- Phase 1 is **read-only** only (no deploy, scale, or arbitrary shell).

## Development

```bash
cd services/spockify-mcp
python -m unittest discover -s tests -v
fastmcp run spockify_mcp.server:mcp   # stdio via FastMCP CLI
```
