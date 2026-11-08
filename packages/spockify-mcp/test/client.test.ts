import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { McpStdioClient, ToolRegistry } from '../src/index';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'echo-server.cjs');

describe('McpStdioClient (real newline-delimited JSON-RPC)', () => {
  it('starts, lists tools, and calls echo over ndjson stdio', async () => {
    const client = new McpStdioClient({
      name: 'fixture',
      command: process.execPath,
      args: [FIXTURE],
    });
    try {
      await client.start();
      const tools = client.listTools();
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['echo', 'fail']);
      assert.equal(tools[0]!.server, 'fixture');

      const r = await client.callTool('echo', { message: 'hello-mcp' });
      assert.equal(r.ok, true);
      assert.equal(r.content, 'hello-mcp');
    } finally {
      await client.stop();
    }
  });

  it('surfaces isError:true as ok:false with the text as the error', async () => {
    const client = new McpStdioClient({
      name: 'fixture',
      command: process.execPath,
      args: [FIXTURE],
    });
    try {
      await client.start();
      const r = await client.callTool('fail', {});
      assert.equal(r.ok, false);
      assert.equal(r.content, 'boom');
      assert.equal(r.error, 'boom');
    } finally {
      await client.stop();
    }
  });

  it('respects an allowlist — disallowed tool is not listed and not callable', async () => {
    const client = new McpStdioClient({
      name: 'fixture',
      command: process.execPath,
      args: [FIXTURE],
      allowlist: ['echo'],
    });
    try {
      await client.start();
      const names = client.listTools().map((t) => t.name);
      assert.deepEqual(names, ['echo']);
      const r = await client.callTool('fail', {});
      assert.equal(r.ok, false);
      assert.match(r.error || '', /not allowed/i);
    } finally {
      await client.stop();
    }
  });

  it('rejects calling an unknown tool name', async () => {
    const client = new McpStdioClient({
      name: 'fixture',
      command: process.execPath,
      args: [FIXTURE],
    });
    try {
      await client.start();
      const r = await client.callTool('nope', {});
      assert.equal(r.ok, false);
      assert.match(r.error || '', /not allowed/i);
    } finally {
      await client.stop();
    }
  });
});

describe('ToolRegistry (multi-server MCP)', () => {
  it('addServer / listTools / callTool / removeServer / dispose', async () => {
    const registry = new ToolRegistry();
    try {
      const tools = await registry.addServer({
        name: 'fixture',
        command: process.execPath,
        args: [FIXTURE],
      });
      assert.equal(tools.length, 2);
      assert.equal(registry.listTools().length, 2);

      const r = await registry.callTool('fixture', 'echo', { message: 'via-registry' });
      assert.equal(r.ok, true);
      assert.equal(r.content, 'via-registry');

      const missing = await registry.callTool('nope', 'echo', {});
      assert.equal(missing.ok, false);
      assert.match(missing.error || '', /Unknown server/);

      await registry.removeServer('fixture');
      assert.equal(registry.listTools().length, 0);
    } finally {
      await registry.dispose();
    }
  });
});
