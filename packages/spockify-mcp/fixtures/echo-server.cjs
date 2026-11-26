#!/usr/bin/env node
/**
 * Minimal fixture MCP stdio server for tests only. Real newline-delimited
 * JSON-RPC (no Content-Length framing). Implements initialize, tools/list,
 * and tools/call for one "echo" tool plus one "fail" tool.
 */
const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the message argument',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'fail',
    description: 'Always returns an MCP tool error',
    inputSchema: { type: 'object', properties: {} },
  },
];

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.method === 'notifications/initialized') {
    return; // notification, no response
  }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture-echo', version: '0.0.1' },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: String(args.message || '') }] },
      });
      return;
    }
    if (name === 'fail') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'boom' }], isError: true },
      });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool ${name}` } });
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } });
});
