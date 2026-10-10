/**
 * Minimal MCP stdio client — list tools + call tool.
 * Not a full marketplace; enough for clone-v1 wire-up.
 */

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Tools allowed; empty = all */
  allowlist?: string[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  server: string;
}

export interface McpToolCallResult {
  ok: boolean;
  content: string;
  error?: string;
}

type JsonRpcId = number;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class McpStdioClient {
  private proc: import('child_process').ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private buffer = '';
  private tools: McpTool[] = [];

  constructor(private readonly config: McpServerConfig) {}

  async start(): Promise<void> {
    const { spawn } = await import('child_process');
    this.proc = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.proc.stderr.on('data', () => {
      /* ignore noise */
    });
    this.proc.on('exit', () => {
      for (const [, p] of this.pending) {
        p.reject(new Error('MCP process exited'));
      }
      this.pending.clear();
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'spockify-ide', version: '0.1.0' },
    });
    await this.notify('notifications/initialized', {});
    await this.refreshTools();
  }

  async stop(): Promise<void> {
    this.proc?.kill();
    this.proc = undefined;
  }

  listTools(): McpTool[] {
    const allow = this.config.allowlist;
    if (!allow?.length) {
      return [...this.tools];
    }
    const set = new Set(allow);
    return this.tools.filter((t) => set.has(t.name));
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolCallResult> {
    const allowed = this.listTools().some((t) => t.name === name);
    if (!allowed) {
      return { ok: false, content: '', error: `Tool not allowed: ${name}` };
    }
    try {
      const result = (await this.request('tools/call', {
        name,
        arguments: args,
      })) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
      const text = (result.content || [])
        .map((c) => c.text || '')
        .join('\n')
        .trim();
      return {
        ok: !result.isError,
        content: text,
        error: result.isError ? text : undefined,
      };
    } catch (err) {
      return {
        ok: false,
        content: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async refreshTools(): Promise<void> {
    const result = (await this.request('tools/list', {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };
    this.tools = (result.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      server: this.config.name,
    }));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }
      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + len) {
        return;
      }
      const body = this.buffer.slice(bodyStart, bodyStart + len);
      this.buffer = this.buffer.slice(bodyStart + len);
      try {
        const msg = JSON.parse(body) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message || 'MCP error'));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  private async notify(method: string, params: unknown): Promise<void> {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(msg: unknown): void {
    if (!this.proc?.stdin) {
      throw new Error('MCP not started');
    }
    const body = JSON.stringify(msg);
    this.proc.stdin.write(
      `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`,
    );
  }
}

export class ToolRegistry {
  private readonly clients = new Map<string, McpStdioClient>();

  async addServer(config: McpServerConfig): Promise<McpTool[]> {
    await this.removeServer(config.name);
    const client = new McpStdioClient(config);
    await client.start();
    this.clients.set(config.name, client);
    return client.listTools();
  }

  async removeServer(name: string): Promise<void> {
    const c = this.clients.get(name);
    if (c) {
      await c.stop();
      this.clients.delete(name);
    }
  }

  listTools(): McpTool[] {
    const out: McpTool[] = [];
    for (const c of this.clients.values()) {
      out.push(...c.listTools());
    }
    return out;
  }

  async callTool(
    server: string,
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const c = this.clients.get(server);
    if (!c) {
      return { ok: false, content: '', error: `Unknown server ${server}` };
    }
    return c.callTool(name, args);
  }

  async dispose(): Promise<void> {
    for (const name of [...this.clients.keys()]) {
      await this.removeServer(name);
    }
  }
}
