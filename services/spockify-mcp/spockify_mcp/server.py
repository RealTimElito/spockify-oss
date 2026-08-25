"""Spockify MCP server — stdio (Cursor) and HTTP (Cloud Agents)."""

from __future__ import annotations

import argparse
import os
import sys

from fastmcp import FastMCP
from fastmcp.server.auth import StaticTokenVerifier

from spockify_mcp.runner import LogService, cluster_status, health, preflight, tab_train_status, tail_logs


def _auth_for_http() -> StaticTokenVerifier:
    token = os.environ.get("SPOCKIFY_MCP_TOKEN", "").strip()
    if not token:
        print(
            "error: SPOCKIFY_MCP_TOKEN is required for HTTP mode",
            file=sys.stderr,
        )
        sys.exit(1)
    return StaticTokenVerifier(tokens={token: {"sub": "spockify-mcp", "client_id": "cloud"}})


def create_mcp(*, http_mode: bool) -> FastMCP:
    """Build FastMCP with Phase 1 read-only tools."""
    auth = _auth_for_http() if http_mode else None
    mcp = FastMCP("spockify-mcp", auth=auth)

    @mcp.tool
    def spockify_cluster_status() -> str:
        """Pods, services, PVCs, and ingress in the spockify namespace (`make status`)."""
        return cluster_status()

    @mcp.tool
    def spockify_tab_train_status() -> str:
        """Tab-train CronJobs, recent jobs, status.json, and champions.json."""
        return tab_train_status()

    @mcp.tool
    def spockify_tail_logs(service: str, lines: int = 100) -> str:
        """Recent logs for openwebui, router, ollama, vllm, or litellm (max 500 lines)."""
        return tail_logs(LogService(service.lower()), lines=lines)

    @mcp.tool
    def spockify_health() -> str:
        """Router /health and /spockify/status (ROUTER_HEALTH_URL)."""
        return health()

    @mcp.tool
    def spockify_preflight() -> str:
        """Pre-deploy checks (`make preflight-deploy`)."""
        return preflight()

    return mcp


def main() -> None:
    parser = argparse.ArgumentParser(description="Spockify read-only MCP server")
    parser.add_argument(
        "--http",
        action="store_true",
        help="Serve Streamable HTTP (Cloud Agents); requires SPOCKIFY_MCP_TOKEN",
    )
    parser.add_argument("--host", default=os.environ.get("SPOCKIFY_MCP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SPOCKIFY_MCP_PORT", "8787")))
    args = parser.parse_args()

    http_mode = args.http or os.environ.get("SPOCKIFY_MCP_HTTP") == "1"
    mcp = create_mcp(http_mode=http_mode)

    if http_mode:
        bind = "0.0.0.0" if args.host in ("0.0.0.0", "::") else args.host
        mcp.run(transport="http", host=bind, port=args.port)
    else:
        mcp.run()


# Exposed for FastMCP CLI (`fastmcp run spockify_mcp.server:mcp`) in stdio mode.
mcp = create_mcp(http_mode=False)

if __name__ == "__main__":
    main()
