/** IDE tool registry adapter onto @spockify/harness ToolRegistry. */
import path from 'node:path';

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
  registerWorkspaceSkillTools(harness, out);
  registerTodoTools(harness, out);
  return out;
}

/** list_skills / activate_skill share the harness session cwd and activeSkills. */
function registerWorkspaceSkillTools(
  harness: HarnessRuntime,
  registry: import('@spockify/harness').ToolRegistry,
): void {
  const names = new Set(registry.listAll().map((t) => t.name));
  const skillsDir = (args: Record<string, unknown>, cwd: string): string => {
    const raw = typeof args.dir === 'string' ? args.dir.trim() : '';
    return raw || path.join(cwd, '.spockify', 'skills');
  };
  if (!names.has('list_skills')) {
    registry.register(
      {
        name: 'list_skills',
        description:
          'List skills under .spockify/skills (<id>/SKILL.md or flat <id>.md).',
        parameters: {
          type: 'object',
          properties: { dir: { type: 'string' } },
        },
        mutates: false,
      },
      async (args, ctx) => {
        const skills = await harness.loadSkills(skillsDir(args, ctx.cwd));
        const text = skills.map((s) => `${s.id}: ${s.title}`).join('\n');
        return { ok: true, content: text || '(no skills)' };
      },
    );
  }
  if (!names.has('activate_skill')) {
    registry.register(
      {
        name: 'activate_skill',
        description:
          'Load a skill body into this turn (max 2). id from list_skills.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            dir: { type: 'string' },
          },
          required: ['id'],
        },
        mutates: false,
      },
      async (args, ctx) => {
        const id = String(args.id || '').trim();
        if (!id) {
          return { ok: false, content: '', error: 'activate_skill requires id' };
        }
        const skills = await harness.loadSkills(skillsDir(args, ctx.cwd));
        const hit = skills.find((s) => s.id === id);
        if (!hit) {
          return { ok: false, content: '', error: `skill not found: ${id}` };
        }
        const attached = harness.attachSkillBody(ctx.activeSkills, hit.body);
        if (!attached.ok) {
          return { ok: false, content: '', error: attached.error };
        }
        return {
          ok: true,
          content: attached.already
            ? `already active: ${hit.id}`
            : `activated ${hit.id} (${hit.title})`,
        };
      },
    );
  }
}

/** In-session plan. Same list the kernel compactor keeps. */
function registerTodoTools(
  harness: HarnessRuntime,
  registry: import('@spockify/harness').ToolRegistry,
): void {
  const names = new Set(registry.listAll().map((t) => t.name));
  const todoParams = {
    type: 'object',
    properties: {
      todos: { type: 'array' },
      merge: { type: 'boolean' },
    },
    required: ['todos'],
  };
  if (!names.has('todowrite')) {
    registry.register(
      {
        name: 'todowrite',
        description:
          'Update the in-session plan. Items: id, content, status (pending|in_progress|completed|cancelled). merge=true updates by id.',
        parameters: todoParams,
        mutates: false,
      },
      async (args, ctx) => {
        const applied = harness.applyTodoWrite(ctx.todos, args);
        if (!applied.ok) {
          return { ok: false, content: '', error: applied.error };
        }
        return { ok: true, content: JSON.stringify(applied.todos, null, 2) };
      },
    );
  }
  if (!names.has('todo')) {
    registry.register(
      {
        name: 'todo',
        description: 'Alias for todowrite.',
        parameters: todoParams,
        mutates: false,
      },
      async (args, ctx) => registry.call('todowrite', args, ctx),
    );
  }
}
