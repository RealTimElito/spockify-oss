/**
 * Opt-in coding swarm. Not Heavy, and not the SPAWN_CODING canary.
 *
 * The parent plans at most four work items. Each worker is one runHarness
 * loop with codingSpawn forced off, so a worker cannot nest or emit a
 * live SPAWN_CODING child. One repair round, then stop.
 * The router never executes these workspace tools.
 */
import type { ModelTransport } from '@spockify/ide-client';
import type { PermissionMemory } from './permissions';
import { runHarness } from './loop';
import { ToolRegistry } from './registry';
import type {
  AgentMessage,
  HarnessEvent,
  HarnessPolicy,
  HarnessSession,
  ThinkingEffort,
} from './types';

export const SWARM_MAX_WORKERS = 4;
/** Initial pass plus one repair. */
export const SWARM_MAX_ROUNDS = 2;

const NEST_TOOLS = new Set([
  'task',
  'swarm',
  'spockify_create_agent_run',
  'create_agent_run',
]);

const PLAN_RE = /SWARM_PLAN\s*:\s*(\[[\s\S]*\])/i;
const ASK_RE = /SWARM_ASK\s*:\s*(.+)/i;

export type SwarmWorkItem = {
  id: string;
  title: string;
  prompt: string;
};

export type SwarmWorkerState = 'running' | 'done' | 'failed' | 'cancelled';

export type SwarmWorkerRow = {
  id: string;
  title: string;
  prompt: string;
  state: SwarmWorkerState;
  /** User-facing label. Cancel is `stopped`. */
  statusLabel: string;
  error?: string;
  digest?: string;
  questions?: string[];
};

export type SwarmResult = {
  kind: 'ask' | 'done' | 'cancelled';
  question?: string;
  transcript: string;
  items: SwarmWorkItem[];
  workers: SwarmWorkerRow[];
  /** Repair rounds actually started (0 or 1). */
  fixRounds: number;
};

export class SwarmRunControl {
  private readonly acs = new Map<string, AbortController>();

  bind(id: string, ac: AbortController): void {
    this.acs.set(id, ac);
  }

  cancel(id: string): boolean {
    const ac = this.acs.get(id);
    if (!ac || ac.signal.aborted) return false;
    ac.abort();
    return true;
  }
}

export function clampSwarmThinking(raw: unknown): ThinkingEffort {
  if (raw === 'off' || raw === 'low' || raw === 'medium' || raw === 'high') {
    return raw;
  }
  return 'medium';
}

export function swarmWorkerPolicy(
  thinking: ThinkingEffort = 'medium',
  maxTurns = 6,
): HarnessPolicy {
  return {
    mode: 'agent',
    codingSpawn: false,
    maxTurns,
    parallelTools: true,
    thinking,
  };
}

/** Vague prompts never launch workers. */
export function clarifySwarmPrompt(prompt: string): string | null {
  const t = prompt.trim();
  if (!t || t.length < 12) {
    return 'What should the swarm change, and which files or tests should it touch?';
  }
  if (/^(fix|help|do|update|change|improve|refactor)\s+(it|this|that|stuff|the code)\b[.!?]?$/i.test(t)) {
    return 'What should the swarm change, and which files or tests should it touch?';
  }
  const words = t.split(/\s+/).filter(Boolean);
  const hasFile = /\.[a-z0-9]{1,5}\b/i.test(t);
  if (words.length < 6 && !hasFile) {
    return 'Which files or tests should each swarm worker handle?';
  }
  return null;
}

export function parseSwarmAsk(text: string): string | null {
  const m = ASK_RE.exec(text || '');
  if (!m) return null;
  const q = m[1].trim().split('\n')[0]?.trim() || '';
  return q.length >= 4 ? q : null;
}

export function capSwarmItems(
  items: readonly SwarmWorkItem[],
  cap = SWARM_MAX_WORKERS,
): SwarmWorkItem[] {
  const limit = Math.max(0, Math.min(SWARM_MAX_WORKERS, cap));
  return items.slice(0, limit);
}

export function parseSwarmPlan(
  text: string,
  cap = SWARM_MAX_WORKERS,
): SwarmWorkItem[] {
  const m = PLAN_RE.exec(text || '');
  if (!m) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(m[1] || '');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const items: SwarmWorkItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const prompt = String(rec.prompt || rec.goal || '').trim();
    if (prompt.length < 8) continue;
    const title = String(rec.title || rec.name || prompt.slice(0, 48)).trim();
    items.push({
      id: `swarm_${items.length + 1}`,
      title: title || `Worker ${items.length + 1}`,
      prompt,
    });
    if (items.length >= cap) break;
  }
  return items;
}

export function extractSwarmQuestions(text: string): string[] {
  const out: string[] = [];
  const blob = text || '';
  for (const match of blob.matchAll(/ASK_USER\s*:\s*(\[[\s\S]*?\])/gi)) {
    try {
      const raw = JSON.parse(match[1] || '');
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const q = String(item || '').trim();
          if (q) out.push(q);
        }
      }
    } catch {
      /* ignore malformed ASK_USER */
    }
  }
  for (const match of blob.matchAll(/^\s*ASK_USER\s*:\s*(?!\s*\[)(.+)$/gim)) {
    const q = String(match[1] || '').trim();
    if (q && !q.startsWith('[')) out.push(q);
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of out) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(q);
  }
  return deduped.slice(0, 8);
}

export function failureFromDigest(digest: string): string | null {
  const m = /LAST_ERROR:\s*(.+)/i.exec(digest || '');
  if (!m) return null;
  const err = m[1].trim();
  if (!err || /^\(none\)$/i.test(err)) return null;
  return err.slice(0, 300);
}

function stripSwarmNoise(text: string): string {
  return (text || '')
    .replace(/SPAWN_CODING\s*:\s*\[[\s\S]*?\]/gi, '')
    .replace(/SWARM_PLAN\s*:\s*\[[\s\S]*?\]/gi, '')
    .replace(/SWARM_ASK\s*:.*/gi, '')
    .trim();
}

function findingsFromMessages(messages: AgentMessage[]): string {
  const assistants = messages.filter(
    (m) => m.role === 'assistant' && m.content.trim(),
  );
  const withDone = [...assistants]
    .reverse()
    .find((m) => /DONE\s*[—:-]/i.test(m.content));
  if (withDone) return withDone.content.trim();
  const substantive = [...assistants].reverse().find((m) => {
    const t = m.content.trim();
    return t.length > 8 && !/^(done|blocked)(\s*[|:].*)?$/i.test(t);
  });
  return (substantive || assistants.at(-1))?.content.trim() || '';
}

export function formatSwarmDigest(input: {
  title: string;
  findings: string;
  error?: string;
  questions?: string[];
}): string {
  const questions = input.questions?.filter(Boolean) || [];
  let body = stripSwarmNoise(input.findings);
  const inlineErr = failureFromDigest(body);
  body = body.replace(/^\s*LAST_ERROR:.*$/gim, '').trim();
  if (!body) body = '(empty)';
  if (body.length > 3500) body = `${body.slice(0, 3499)}…`;
  const err = (input.error || inlineErr || '(none)').trim();
  const ask = questions.length
    ? `\nASK_USER:\n${questions.map((q) => `- ${q}`).join('\n')}`
    : '';
  return (
    `### DONE — ${input.title}\n` +
    `FINDINGS:\n${body}\n` +
    `LAST_ERROR: ${err}` +
    ask
  );
}

/** Parent merge treats DONE digests as finished work, not a new plan. */
export function mergeSwarmTranscript(input: {
  items: readonly SwarmWorkItem[];
  workers: readonly SwarmWorkerRow[];
  fixRounds: number;
}): string {
  const plan = input.items
    .map((item, i) => `${i + 1}. ${item.title} — ${item.prompt}`)
    .join('\n');
  const digests = input.workers
    .map((w) => w.digest || `### DONE — ${w.title}\nFINDINGS:\n(empty)\nLAST_ERROR: (none)`)
    .join('\n\n');
  const questions: string[] = [];
  const seen = new Set<string>();
  for (const w of input.workers) {
    for (const q of w.questions || []) {
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(q);
    }
  }
  let text =
    `## Plan\n${plan || '(no items)'}\n\n` +
    `## Completed work\n` +
    `These digests are completed work, not a new plan.\n\n${digests}`;
  if (input.fixRounds > 0) {
    text += `\n\nRepair rounds used: ${input.fixRounds} (limit 1).`;
  }
  if (questions.length) {
    text += `\n\nNeed from you:\n${questions.map((q) => `- ${q}`).join('\n')}`;
  }
  return text;
}

function workerRegistry(parent: ToolRegistry): ToolRegistry {
  const out = new ToolRegistry();
  for (const tool of parent.listAll()) {
    if (NEST_TOOLS.has(tool.name)) continue;
    out.register(
      {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        mutates: tool.mutates,
      },
      (args, ctx) => parent.call(tool.name, args, ctx),
    );
  }
  return out;
}

function workerSystem(item: SwarmWorkItem): string {
  return [
    'You are one swarm worker. Complete only this work item.',
    'Use the tools you have: read, edit, shell, and diagnostics.',
    'Do not spawn another swarm. Do not emit SPAWN_CODING, SWARM_PLAN, or a task tool.',
    'When you finish, include a line `DONE — <completed work>` and a line `LAST_ERROR: (none)` or `LAST_ERROR: <reason>`.',
    'If you must ask the user something, add ASK_USER: ["question"].',
    'End with a final line that is exactly `done`.',
    `Title: ${item.title}`,
    `Work item: ${item.prompt}`,
  ].join('\n');
}

async function drainHarness(
  gen: AsyncGenerator<HarnessEvent, HarnessSession, void>,
): Promise<HarnessSession | undefined> {
  let session: HarnessSession | undefined;
  while (true) {
    const next = await gen.next();
    if (next.done) {
      session = next.value;
      break;
    }
  }
  return session;
}

const PLANNER_SYSTEM = [
  'You are the Spockify swarm planner. You do not edit files and you do not call tools.',
  'If the task is ambiguous, reply with exactly one line: SWARM_ASK: <one short question>',
  'Otherwise reply with SWARM_PLAN: a JSON array of 2 to 4 objects {title, prompt}.',
  'Each prompt is one concrete coding work item (files, behavior, or tests).',
  'Do not emit SPAWN_CODING. Do not write the code yourself.',
].join('\n');

async function collectPlanText(
  transport: ModelTransport,
  model: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  let text = '';
  for await (const chunk of transport.streamChatCompletions(
    {
      model,
      messages: [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
    },
    signal,
  )) {
    if (chunk.content) text += chunk.content;
  }
  return text;
}

export async function runSwarm(options: {
  transport: ModelTransport;
  registry: ToolRegistry;
  model: string;
  cwd: string;
  userPrompt: string;
  permissions?: PermissionMemory;
  confirm?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  signal?: AbortSignal;
  thinking?: unknown;
  yolo?: boolean;
  control?: SwarmRunControl;
  onWorker?: (row: SwarmWorkerRow) => void;
  onEvent?: (event: HarnessEvent) => void;
  /** When set, a clarifying question waits for the terminal or IDE. */
  askUser?: (prompt: string) => Promise<string>;
  /** Internal cap so one answer cannot loop the planner. */
  askDepth?: number;
}): Promise<SwarmResult> {
  const control = options.control ?? new SwarmRunControl();
  const thinking = clampSwarmThinking(options.thinking);
  const policy = swarmWorkerPolicy(thinking);
  if (options.yolo) policy.yolo = true;
  const empty = (
    kind: SwarmResult['kind'],
    transcript: string,
    extra: Partial<SwarmResult> = {},
  ): SwarmResult => ({
    kind,
    transcript,
    items: extra.items || [],
    workers: extra.workers || [],
    fixRounds: extra.fixRounds || 0,
    question: extra.question,
  });

  if (options.signal?.aborted) {
    return empty('cancelled', 'Swarm stopped.');
  }

  const askAndMaybeContinue = async (prompt: string): Promise<SwarmResult> => {
    options.onEvent?.({ type: 'askUser', prompt });
    const depth = options.askDepth ?? 0;
    if (!options.askUser || depth >= 1) {
      return empty('ask', prompt, { question: prompt });
    }
    let answer = '';
    try {
      answer = (await options.askUser(prompt)).trim();
    } catch {
      answer = '';
    }
    if (options.signal?.aborted) return empty('cancelled', 'Swarm stopped.');
    if (!answer) return empty('ask', prompt, { question: prompt });
    return runSwarm({
      ...options,
      askDepth: depth + 1,
      userPrompt: `${options.userPrompt}\n\nClarification from the user: ${answer}`,
    });
  };

  const vague = clarifySwarmPrompt(options.userPrompt);
  if (vague) return askAndMaybeContinue(vague);

  options.onEvent?.({ type: 'status', text: 'Swarm · planning' });
  let planText = '';
  try {
    planText = await collectPlanText(
      options.transport,
      options.model,
      options.userPrompt,
      options.signal,
    );
  } catch (err) {
    if (options.signal?.aborted) return empty('cancelled', 'Swarm stopped.');
    const message = err instanceof Error ? err.message : String(err);
    options.onEvent?.({ type: 'error', message });
    return empty('done', `Swarm planner failed: ${message}`);
  }

  if (options.signal?.aborted) return empty('cancelled', 'Swarm stopped.');

  const asked = parseSwarmAsk(planText);
  if (asked) return askAndMaybeContinue(asked);

  const items = capSwarmItems(parseSwarmPlan(planText, SWARM_MAX_WORKERS));
  if (!items.length) {
    return askAndMaybeContinue(
      'I could not split that into concrete work items. Which files should each worker change?',
    );
  }

  const tools = workerRegistry(options.registry);
  const workers: SwarmWorkerRow[] = [];

  const runOne = async (
    item: SwarmWorkItem,
    prior: HarnessSession | undefined,
    priorDigest?: string,
  ): Promise<{ row: SwarmWorkerRow; session?: HarnessSession }> => {
    const child = new AbortController();
    const onParent = () => child.abort();
    options.signal?.addEventListener('abort', onParent);
    if (options.signal?.aborted) child.abort();
    control.bind(item.id, child);
    const questions: string[] = [];
    let row: SwarmWorkerRow = {
      id: item.id,
      title: item.title,
      prompt: item.prompt,
      state: 'running',
      statusLabel: 'running',
    };
    options.onWorker?.(row);

    const baseMessages: AgentMessage[] = prior?.messages?.length
      ? prior.messages.filter((m) => m.role !== 'system')
      : [{ role: 'user', content: item.prompt }];
    if (priorDigest) {
      baseMessages.push({
        role: 'user',
        content:
          'SWARM_REPAIR_ROUND\n' +
          'The previous attempt failed. This is the only repair round. ' +
          'Fix the failure, re-check it, and finish with DONE. ' +
          'Do not spawn workers. Do not emit SPAWN_CODING or SWARM_PLAN.\n\n' +
          priorDigest,
      });
    }

    const session: HarnessSession = {
      messages: baseMessages,
      tick: prior?.tick || 0,
      readSet: prior?.readSet ? [...prior.readSet] : [],
      toolLog: [],
      todos: prior?.todos ? [...prior.todos] : [],
      cwd: options.cwd,
      model: options.model,
    };

    let settled: HarnessSession | undefined;
    try {
      if (!child.signal.aborted) {
        settled = await drainHarness(
          runHarness({
            transport: options.transport,
            session,
            registry: tools,
            policy,
            signal: child.signal,
            permissions: options.permissions,
            confirm: options.confirm,
            askUser: options.askUser,
            systemPrompt: workerSystem(item),
            onEvent: (event) => {
              if (event.type === 'askUser' && event.prompt.trim()) {
                questions.push(event.prompt.trim());
              }
              options.onEvent?.(event);
            },
          }),
        );
      }
    } catch (err) {
      if (!child.signal.aborted && !options.signal?.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        row = {
          ...row,
          state: 'failed',
          statusLabel: 'failed',
          error: message,
          questions,
        };
        options.onWorker?.(row);
        return { row, session: settled };
      }
    } finally {
      options.signal?.removeEventListener('abort', onParent);
    }

    if (child.signal.aborted || options.signal?.aborted) {
      row = {
        ...row,
        state: 'cancelled',
        statusLabel: 'stopped',
        error: 'stopped',
        questions,
      };
      options.onWorker?.(row);
      return { row, session: settled };
    }

    const messages = settled?.messages || session.messages;
    const findings = findingsFromMessages(messages);
    const fromText = extractSwarmQuestions(findings);
    const allQuestions: string[] = [];
    const seenQ = new Set<string>();
    for (const q of [...questions, ...fromText]) {
      const key = q.toLowerCase();
      if (!q || seenQ.has(key)) continue;
      seenQ.add(key);
      allQuestions.push(q);
    }
    const inlineErr = failureFromDigest(findings);
    const digest = formatSwarmDigest({
      title: item.title,
      findings,
      error: inlineErr || undefined,
      questions: allQuestions,
    });
    const failed = failureFromDigest(digest);
    row = {
      id: item.id,
      title: item.title,
      prompt: item.prompt,
      state: failed ? 'failed' : 'done',
      statusLabel: failed ? 'failed' : 'done',
      error: failed || undefined,
      digest,
      questions: allQuestions,
    };
    options.onWorker?.(row);
    return { row, session: settled || session };
  };

  const sessions = new Map<string, HarnessSession | undefined>();
  await Promise.all(
    items.map(async (item) => {
      const result = await runOne(item, undefined);
      sessions.set(item.id, result.session);
      workers.push(result.row);
    }),
  );
  workers.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  let fixRounds = 0;
  const fixer = workers.find(
    (row) => row.state === 'failed' && row.error && row.statusLabel !== 'stopped',
  );
  if (fixer && !options.signal?.aborted && SWARM_MAX_ROUNDS >= 2) {
    fixRounds = 1;
    options.onEvent?.({
      type: 'status',
      text: `Swarm · repair ${fixer.title}`,
    });
    const item = items.find((it) => it.id === fixer.id);
    if (item) {
      const again = await runOne(item, sessions.get(item.id), fixer.digest);
      const idx = workers.findIndex((row) => row.id === fixer.id);
      if (idx >= 0) workers[idx] = again.row;
    }
  }

  if (options.signal?.aborted) {
    for (const row of workers) {
      if (row.state === 'running') {
        row.state = 'cancelled';
        row.statusLabel = 'stopped';
        row.error = 'stopped';
        options.onWorker?.(row);
      }
    }
  }

  const transcript = mergeSwarmTranscript({ items, workers, fixRounds });
  options.onEvent?.({ type: 'status', text: 'Swarm · merged' });
  const kind = options.signal?.aborted ? 'cancelled' : 'done';
  return {
    kind,
    transcript,
    items,
    workers,
    fixRounds,
  };
}
