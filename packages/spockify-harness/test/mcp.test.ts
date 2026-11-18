import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { IsolationRequiredError } from '../src/isolate';
import { ToolRegistry } from '../src/registry';
import {
  McpConfigError,
  McpToolHost,
  assertMcpProductionReady,
  loadMcpConfig,
  mcpConfigPath,
  mcpToolName,
  parseMcpToolName,
} from '../src/mcp';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'mcp', 'echo-server.cjs');

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('mcp tool naming', () => {
  it('round-trips server/tool through mcpToolName/parseMcpToolName', () => {
    const name = mcpToolName('fs-server', 'read_file');
    assert.equal(name, 'mcp__fs-server__read_file');
    assert.deepEqual(parseMcpToolName(name), { server: 'fs-server', tool: 'read_file' });
  });

  it('rejects a non-mcp tool name', () => {
    assert.equal(parseMcpToolName('shell'), null);
  });
});

describe('loadMcpConfig', () => {
  it('returns [] when the config file is missing (no behavior change)', async () => {
    const dir = await tmpDir('mcp-cfg-missing-');
    assert.deepEqual(loadMcpConfig(dir), []);
  });

  it('returns [] when servers is empty or absent', async () => {
    const dir = await tmpDir('mcp-cfg-empty-');
    await fs.mkdir(path.join(dir, '.spockify'), { recursive: true });
    await fs.writeFile(mcpConfigPath(dir), JSON.stringify({}), 'utf8');
    assert.deepEqual(loadMcpConfig(dir), []);
    await fs.writeFile(mcpConfigPath(dir), JSON.stringify({ servers: [] }), 'utf8');
    assert.deepEqual(loadMcpConfig(dir), []);
  });

  it('parses a valid multi-server config with allowlist/env/args', async () => {
    const dir = await tmpDir('mcp-cfg-valid-');
    await fs.mkdir(path.join(dir, '.spockify'), { recursive: true });
    await fs.writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        servers: [
          { name: 'fixture', command: process.execPath, args: [FIXTURE] },
          {
            name: 'fixture-limited',
            command: process.execPath,
            args: [FIXTURE],
            allowlist: ['echo'],
            env: { FOO: 'bar' },
          },
        ],
      }),
      'utf8',
    );
    const configs = loadMcpConfig(dir);
    assert.equal(configs.length, 2);
    assert.equal(configs[0]!.name, 'fixture');
    assert.equal(configs[1]!.allowlist?.[0], 'echo');
    assert.equal(configs[1]!.env?.FOO, 'bar');
  });

  it('rejects malformed JSON with a clear error', async () => {
    const dir = await tmpDir('mcp-cfg-badjson-');
    await fs.mkdir(path.join(dir, '.spockify'), { recursive: true });
    await fs.writeFile(mcpConfigPath(dir), '{ not json', 'utf8');
    assert.throws(() => loadMcpConfig(dir), McpConfigError);
  });

  it('rejects a server missing a name or command', async () => {
    const dir = await tmpDir('mcp-cfg-badentry-');
    await fs.mkdir(path.join(dir, '.spockify'), { recursive: true });
    await fs.writeFile(
      mcpConfigPath(dir),
      JSON.stringify({ servers: [{ command: 'echo' }] }),
      'utf8',
    );
    assert.throws(() => loadMcpConfig(dir), McpConfigError);
  });

  it('rejects duplicate server names', async () => {
    const dir = await tmpDir('mcp-cfg-dup-');
    await fs.mkdir(path.join(dir, '.spockify'), { recursive: true });
    await fs.writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        servers: [
          { name: 'a', command: 'echo' },
          { name: 'a', command: 'echo' },
        ],
      }),
      'utf8',
    );
    assert.throws(() => loadMcpConfig(dir), McpConfigError);
  });
});

describe('assertMcpProductionReady (fail-closed)', () => {
  it('is a no-op on the workstation default', () => {
    assert.doesNotThrow(() => assertMcpProductionReady({ PATH: process.env.PATH }));
  });

  it('throws in production without the explicit MCP opt-in', () => {
    assert.throws(
      () =>
        assertMcpProductionReady({
          PATH: process.env.PATH,
          SPOCKIFY_PRODUCTION: '1',
        }),
      IsolationRequiredError,
    );
  });

  it('throws in production with the opt-in but no isolated runner resolves', () => {
    assert.throws(
      () =>
        assertMcpProductionReady({
          PATH: '/nonexistent-bin-only',
          SPOCKIFY_PRODUCTION: '1',
          SPOCKIFY_MCP_ALLOW_PRODUCTION: '1',
        }),
      IsolationRequiredError,
    );
  });
});

describe('McpToolHost.attach', () => {
  it('is a true no-op for an empty config list (no env check, no spawn)', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    const discovered = await host.attach(registry, [], {
      PATH: process.env.PATH,
      SPOCKIFY_PRODUCTION: '1', // would throw if attach touched the gate for []
    });
    assert.deepEqual(discovered, []);
    assert.equal(registry.listAll().length, 0);
    await host.dispose();
  });

  it('discovers and registers mcp__<server>__<tool> tools on the harness registry', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    try {
      const discovered = await host.attach(registry, [
        { name: 'fixture', command: process.execPath, args: [FIXTURE] },
      ]);
      assert.equal(discovered.length, 2);
      const names = registry.listAll().map((t) => t.name).sort();
      assert.deepEqual(names, ['mcp__fixture__echo', 'mcp__fixture__fail']);
      const tool = registry.listAll().find((t) => t.name === 'mcp__fixture__echo')!;
      assert.equal(tool.mutates, true);
      assert.match(tool.description, /\[MCP:fixture\]/);
    } finally {
      await host.dispose();
    }
  });

  it('calling an mcp tool through the registry round-trips via the real broker (confirm gate)', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    try {
      await host.attach(registry, [
        { name: 'fixture', command: process.execPath, args: [FIXTURE] },
      ]);
      const confirmed: string[] = [];
      const ctx = {
        cwd: process.cwd(),
        mode: 'agent' as const,
        yolo: false,
        confirm: async (name: string) => {
          confirmed.push(name);
          return true;
        },
      };
      const r = await registry.call(
        'mcp__fixture__echo',
        { message: 'hello-harness' },
        ctx,
      );
      assert.equal(r.ok, true);
      assert.equal(r.content, 'hello-harness');
      // mutates:true routed this through the same confirm gate as shell.
      assert.deepEqual(confirmed, ['mcp__fixture__echo']);
    } finally {
      await host.dispose();
    }
  });

  it('a user-denied confirm blocks the mcp tool call (same broker as shell)', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    try {
      await host.attach(registry, [
        { name: 'fixture', command: process.execPath, args: [FIXTURE] },
      ]);
      const ctx = {
        cwd: process.cwd(),
        mode: 'agent' as const,
        yolo: false,
        confirm: async () => false,
      };
      const r = await registry.call('mcp__fixture__echo', { message: 'nope' }, ctx);
      assert.equal(r.ok, false);
      assert.match(r.error || '', /denied/i);
    } finally {
      await host.dispose();
    }
  });

  it('surfaces an MCP tool error as ok:false', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    try {
      await host.attach(registry, [
        { name: 'fixture', command: process.execPath, args: [FIXTURE] },
      ]);
      const ctx = { cwd: process.cwd(), mode: 'agent' as const, yolo: true };
      const r = await registry.call('mcp__fixture__fail', {}, ctx);
      assert.equal(r.ok, false);
      assert.equal(r.error, 'boom');
    } finally {
      await host.dispose();
    }
  });

  it('plan/ask mode blocks mcp tools the same as any other mutating tool', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    try {
      await host.attach(registry, [
        { name: 'fixture', command: process.execPath, args: [FIXTURE] },
      ]);
      const ctx = { cwd: process.cwd(), mode: 'plan' as const, yolo: true };
      const r = await registry.call('mcp__fixture__echo', { message: 'x' }, ctx);
      assert.equal(r.ok, false);
      assert.match(r.error || '', /blocked in plan\/ask mode/i);
    } finally {
      await host.dispose();
    }
  });

  it('attach throws fail-closed in production before spawning any server', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    await assert.rejects(
      () =>
        host.attach(
          registry,
          [{ name: 'fixture', command: process.execPath, args: [FIXTURE] }],
          { PATH: process.env.PATH, SPOCKIFY_PRODUCTION: '1' },
        ),
      IsolationRequiredError,
    );
    assert.equal(registry.listAll().length, 0);
    await host.dispose();
  });

  it('dispose stops all started servers and is safe to call twice', async () => {
    const registry = new ToolRegistry();
    const host = new McpToolHost();
    await host.attach(registry, [
      { name: 'fixture', command: process.execPath, args: [FIXTURE] },
    ]);
    assert.equal(host.serverNames.length, 1);
    await host.dispose();
    await host.dispose();
  });
});
