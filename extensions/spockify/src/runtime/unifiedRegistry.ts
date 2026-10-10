/**
 * Unified tool registry — MCP + terminal + apply + remote Spockify tools.
 */

import type {
  AgentMode,
  RegisteredTool,
  ToolCallResult,
  ToolExecutionContext,
  ToolExecutor,
  UnifiedToolDefinition,
} from './types';
import { filterToolsForMode, isToolAllowed } from './modes';

export class UnifiedToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(def: UnifiedToolDefinition, execute: ToolExecutor): void {
    this.tools.set(def.name, { ...def, execute });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  listAll(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  listForMode(mode: AgentMode, strictAllowlist: string[]): RegisteredTool[] {
    return filterToolsForMode(this.listAll(), mode, strictAllowlist);
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
    strictAllowlist: string[],
  ): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, content: '', error: `Unknown tool: ${name}` };
    }
    const gate = isToolAllowed(tool, ctx.mode, strictAllowlist, {
      composerUiMode: ctx.composerUiMode,
      planApproved: ctx.planApproved,
    });
    if (!gate.ok) {
      return { ok: false, content: '', error: gate.reason };
    }
    if (ctx.signal?.aborted) {
      return { ok: false, content: '', error: 'cancelled' };
    }
    try {
      return await tool.execute(args, ctx);
    } catch (err) {
      return {
        ok: false,
        content: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

let shared: UnifiedToolRegistry | undefined;

export function getUnifiedToolRegistry(): UnifiedToolRegistry {
  if (!shared) {
    shared = new UnifiedToolRegistry();
  }
  return shared;
}

/** Test / AppImage rebuild helper — reset singleton. */
export function resetUnifiedToolRegistry(): void {
  shared = new UnifiedToolRegistry();
}
