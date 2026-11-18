/**
 * MCP (Model Context Protocol) client MVP for the coding harness.
 *
 * Scope: stdio MCP servers only (per the MCP spec, the recommended local
 * transport). Discovers each server's tools once at attach time and exposes
 * them as ordinary harness tools (`mcp__<server>__<tool>`) so the existing
 * `ToolRegistry` confirm/yolo/policy broker, not a second code path, decides
 * whether a call actually runs. Every MCP tool is registered `mutates: true`
 * — an external MCP server is an unknown effect surface, so it gets the same
 * confirm gate as `shell` rather than being assumed read-only.
 *
 * Production isolation: an MCP server command is an arbitrary subprocess the
 * operator configured. In a `SPOCKIFY_PRODUCTION` profile that must not
 * become a silent isolation bypass, so MCP stays fail-closed there unless the
 * operator explicitly opts in (`SPOCKIFY_MCP_ALLOW_PRODUCTION=1`) *and* an
 * isolated runner (`SPOCKIFY_ISOLATED_RUNNER=bwrap|podman`) actually resolves.
 * Workstation default (no production flags) is unaffected — this module is a
 * no-op when `.spockify/mcp.json` lists no servers, so default `runHarness`
 * behavior does not change.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  McpStdioClient,
  type McpServerConfig,
  type McpTool,
} from '@spockify/mcp';
import { IsolationRequiredError, productionRequested, resolveIsolation } from './isolate';
import type { ToolRegistry } from './registry';
import type { ToolCallResult } from './types';

export type { McpServerConfig, McpTool, McpToolCallResult } from '@spockify/mcp';

const MCP_CONFIG_REL = ['.spockify', 'mcp.json'] as const;
const MCP_TOOL_PREFIX = 'mcp__';
const SERVER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function mcpConfigPath(cwd: string): string {
  return path.join(cwd, ...MCP_CONFIG_REL);
}

export type McpConfigFile = { servers?: unknown };

export class McpConfigError extends Error {}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * Load `.spockify/mcp.json` (or an explicit path). A missing file, or a file
 * with an empty/absent `servers` array, returns `[]` — the harness attaches
 * zero MCP tools and behaves exactly as before this feature existed.
 */
export function loadMcpConfig(
  cwd: string,
  configPath?: string,
): McpServerConfig[] {
  const p = configPath || mcpConfigPath(cwd);
  if (!fs.existsSync(p)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new McpConfigError(
      `invalid MCP config JSON at ${p}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const servers = (raw as McpConfigFile)?.servers;
  if (servers === undefined) return [];
  if (!Array.isArray(servers)) {
    throw new McpConfigError(`${p}: "servers" must be an array`);
  }
  const out: McpServerConfig[] = [];
  const seen = new Set<string>();
  for (const entry of servers) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new McpConfigError(`${p}: each server entry must be an object`);
    }
    const rec = entry as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const command = typeof rec.command === 'string' ? rec.command.trim() : '';
    if (!name || !SERVER_NAME_RE.test(name)) {
      throw new McpConfigError(
        `${p}: server "name" must be 1-64 chars of [a-zA-Z0-9_-] (got ${JSON.stringify(rec.name)})`,
      );
    }
    if (!command) {
      throw new McpConfigError(`${p}: server "${name}" is missing "command"`);
    }
    if (seen.has(name)) {
      throw new McpConfigError(`${p}: duplicate MCP server name "${name}"`);
    }
    seen.add(name);
    const env =
      rec.env && typeof rec.env === 'object' && !Array.isArray(rec.env)
        ? Object.fromEntries(
            Object.entries(rec.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        : undefined;
    out.push({
      name,
      command,
      args: asStringArray(rec.args),
      env,
      allowlist: asStringArray(rec.allowlist),
    });
  }
  return out;
}

/** `mcp__<server>__<tool>` — double underscore keeps server/tool names apart. */
export function mcpToolName(server: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${server}__${tool}`;
}

export function parseMcpToolName(
  name: string,
): { server: string; tool: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const idx = rest.indexOf('__');
  if (idx < 0) return null;
  const server = rest.slice(0, idx);
  const tool = rest.slice(idx + 2);
  if (!server || !tool) return null;
  return { server, tool };
}

/**
 * Fail-closed production gate. Throws `IsolationRequiredError` instead of
 * silently starting an uninspected subprocess when a production profile is
 * active and the operator has not explicitly opted in with a working
 * isolated runner. No-op on the workstation default.
 */
export function assertMcpProductionReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!productionRequested(env)) return;
  if (env.SPOCKIFY_MCP_ALLOW_PRODUCTION !== '1') {
    throw new IsolationRequiredError(
      'MCP is disabled in production (set SPOCKIFY_MCP_ALLOW_PRODUCTION=1 to ' +
        'run configured MCP servers through the isolated runner; an MCP ' +
        'server is an uninspected subprocess and stays fail-closed otherwise)',
    );
  }
  const resolved = resolveIsolation(env);
  if (resolved.backend === 'none') {
    throw new IsolationRequiredError(
      'MCP requires an isolated runner in production (set ' +
        'SPOCKIFY_ISOLATED_RUNNER=bwrap|podman and install it)',
    );
  }
}

/** Live handle for started MCP servers this session; disposes cleanly. */
export class McpToolHost {
  private readonly clients = new Map<string, McpStdioClient>();

  /** Discovered tools across all attached servers (for status/debug UIs). */
  get tools(): McpTool[] {
    const out: McpTool[] = [];
    for (const client of this.clients.values()) out.push(...client.listTools());
    return out;
  }

  get serverNames(): string[] {
    return [...this.clients.keys()];
  }

  /**
   * Start each configured server, discover its tools, and register them on
   * `registry`. Empty `configs` is a true no-op (no env check, no spawn) so
   * default `runHarness` sessions are unaffected.
   */
  async attach(
    registry: ToolRegistry,
    configs: McpServerConfig[],
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<McpTool[]> {
    if (!configs.length) return [];
    assertMcpProductionReady(env);
    const discovered: McpTool[] = [];
    for (const config of configs) {
      const client = new McpStdioClient(config);
      await client.start();
      this.clients.set(config.name, client);
      const tools = client.listTools();
      discovered.push(...tools);
      for (const tool of tools) {
        const description = `[MCP:${config.name}] ${tool.description || tool.name}`.slice(
          0,
          500,
        );
        registry.register(
          {
            name: mcpToolName(config.name, tool.name),
            description,
            // Conservative default: an MCP tool's side effects are unknown
            // to the harness, so route through the same confirm/yolo broker
            // as shell rather than assuming read-only.
            mutates: true,
            parameters:
              (tool.inputSchema as Record<string, unknown> | undefined) || {
                type: 'object',
                properties: {},
              },
          },
          async (args): Promise<ToolCallResult> => {
            const r = await client.callTool(tool.name, args);
            if (r.ok) return { ok: true, content: r.content };
            return { ok: false, content: r.content, error: r.error || 'mcp tool error' };
          },
        );
      }
    }
    return discovered;
  }

  async dispose(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((c) => c.stop()));
  }
}
