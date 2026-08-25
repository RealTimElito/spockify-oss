/**
 * Curated MCP server templates (marketplace-lite).
 */

import type { McpServerConfig } from '@spockify/mcp';

export interface McpCatalogEntry {
  id: string;
  label: string;
  detail: string;
  config: McpServerConfig;
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'filesystem',
    label: 'Filesystem (stdio)',
    detail: 'Official @modelcontextprotocol/server-filesystem — set WORKSPACE path in args',
    config: {
      name: 'filesystem',
      command: 'npx',
      args: [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '${workspaceFolder}',
      ],
    },
  },
  {
    id: 'fetch',
    label: 'Fetch (stdio)',
    detail: 'HTTP fetch MCP — read URLs from the agent',
    config: {
      name: 'fetch',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
    },
  },
  {
    id: 'brave-search',
    label: 'Brave Search',
    detail: 'Requires BRAVE_API_KEY in env',
    config: {
      name: 'brave-search',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '${input:braveApiKey}' },
    },
  },
  {
    id: 'git',
    label: 'Git (stdio)',
    detail: 'Git read operations for the repo',
    config: {
      name: 'git',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-git', '--repository', '${workspaceFolder}'],
    },
  },
];

export function expandCatalogConfig(
  entry: McpCatalogEntry,
  workspaceFolder?: string,
): McpServerConfig {
  const folder = workspaceFolder || '.';
  const raw = JSON.stringify(entry.config);
  const expanded = raw
    .replace(/\$\{workspaceFolder\}/g, folder)
    .replace(/\$\{input:braveApiKey\}/g, '');
  const cfg = JSON.parse(expanded) as McpServerConfig;
  if (entry.id === 'brave-search' && cfg.env) {
    delete cfg.env.BRAVE_API_KEY;
  }
  return cfg;
}
