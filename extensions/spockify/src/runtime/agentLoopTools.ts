/** IDE tool registry adapter onto @spockify/harness ToolRegistry. */
import type { AgentMode } from './types';
import type { UnifiedToolRegistry } from './unifiedRegistry';

type HarnessRuntime = typeof import('@spockify/harness');

export interface IdeToolDeps {
  registry: UnifiedToolRegistry;
  strictAllowlist: string[];
  output?: { appendLine(line: string): void };
}

export function ideToolsToHarness(
  harness: HarnessRuntime,
  ide: UnifiedToolRegistry,
  deps: IdeToolDeps,
  sessionId: string,
  mode: AgentMode,
): import('@spockify/harness').ToolRegistry {
  const out = new harness.ToolRegistry();
  for (const t of ide.listForMode(mode, deps.strictAllowlist)) {
    out.register(
      {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        mutates: t.mutates,
      },
      async (args, ctx) => {
        const r = await ide.call(
          t.name,
          args,
          {
            signal: ctx.signal,
            sessionId,
            mode,
            output: deps.output,
          },
          deps.strictAllowlist,
        );
        return {
          ok: r.ok,
          content: r.content,
          error: r.error,
        };
      },
    );
  }
  return out;
}
