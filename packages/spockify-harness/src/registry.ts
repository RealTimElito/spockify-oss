import {
  isReadOnlyMode,
  type AgentMode,
  type RegisteredTool,
  type ToolCallResult,
  type ToolExecutionContext,
  type ToolExecutor,
  type UnifiedToolDefinition,
} from './types';

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(def: UnifiedToolDefinition, execute: ToolExecutor): void {
    this.tools.set(def.name, { ...def, execute });
  }

  listForMode(mode: AgentMode): RegisteredTool[] {
    const readOnly = isReadOnlyMode(mode);
    return [...this.tools.values()].filter((t) => !(readOnly && t.mutates));
  }

  listAll(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  openAiTools(mode: AgentMode): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.listForMode(mode).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolCallResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, content: '', error: `Unknown tool: ${name}` };
    if (isReadOnlyMode(ctx.mode) && tool.mutates) {
      return {
        ok: false,
        content: '',
        error: `Tool "${name}" blocked in plan/ask mode`,
      };
    }
    if (tool.mutates && !ctx.yolo && ctx.confirm) {
      if (!ctx.permissions?.allows(name, args)) {
        const ok = await ctx.confirm(name, args);
        if (!ok) return { ok: false, content: '', error: 'User denied tool' };
        ctx.permissions?.remember(name, args);
      }
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
