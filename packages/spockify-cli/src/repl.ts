import type { ModelTransport } from '@spockify/ide-client';
import {
  codingPickerItems,
  confirmOnce,
  isAutoModelId,
  isLabCatalogId,
  isSelectableCodingId,
  isWriteTool,
  loadAgentsMd,
  loadSkills,
  PermissionMemory,
  pickSkillsByName,
} from '@spockify/harness';
import {
  openSessionTransport,
  resolveLabPinTarget,
} from './labPin';
import path from 'node:path';
import { runAgentTurn } from './agent/loop';
import { tryCliPlugin } from './harness/dispatch';
import { ToolRegistry } from './agent/registry';
import { registerCliTools } from './agent/tools';
import { registerEvalTools } from './pentestEval/tools';
import { enforceObedience } from './pentestEval/obey';
import { loadDefaultEvalSkills, loadEvalSkillPool, runSubmitGate } from './pentestEval/turn';
import { openEvalTransport } from './pentestEval/evalTransport';
import type { EvalSession } from './pentestEval/session';
import { appendEvalActivity, clearEvalThoughts, logEvalOperator, noteEvalThought, setEvalActivityDir } from './pentestEval/activity';
import { approveEvalPending, expandEvalReport, formatEvalScore, handleEvalFindings, submitEvalReport } from './pentestEval/operator';
import type { AgentMessage, AgentMode } from './agent/types';
import { DEFAULT_MODEL } from './config';
import { DEFAULT_EVAL_PLANNER, EVAL_PLANNER_PRESETS } from './pentestEval/planner';
import { buildAgentPrompt, loadScopeBrief, type ScopeView } from './pentestEval/prompt';
import {
  formatChatHint,
  attachAssistantReasoning,
  listEvalChats,
  saveEvalChat,
  type SavedChat,
} from './pentestEval/continue';
import { DoublePressExit, type ExitKey } from './exitGuard';
import { readBoxedLine, readLineRaw } from './inputRaw';
import {
  isModelMetaCommand,
  resolveModelId,
  type ModelPreset,
} from './models';
import { fetchStackModels, resolveStackApiBackend } from './discover';
import { pickFromList } from './picker';
import {
  MarkdownStreamRenderer,
  Spinner,
  agentsStatusLine,
  disableMouseTracking,
  modelLabel,
  renderAssistantStart,
  renderBanner,
  renderError,
  renderGoodbye,
  renderHelp,
  renderHint,
  renderReasoning,
  renderToolsList,
  renderStatusLine,
  renderStatusPanel,
  renderToolResultCard,
  renderToolStart,
  toolStatusLine,
  renderPermissionRequest,
  type SessionUiState,
  ansi,
} from './ui';
import {
  isThinkingMode,
  nextThinkingMode,
  normalizeThinkingMode,
  resolveInitialThinkingMode,
  thinkingModeLabel,
  type ThinkingMode,
} from './thinking';

export interface ReplOptions {
  apiKey: string;
  baseUrl: string;
  /** Discover/creds host — restore this when leaving a lab pin. */
  configuredBaseUrl?: string;
  model: string;
  /** Id sent to /v1/chat/completions (Ollama tag for lab pins). */
  apiModel?: string;
  mode: AgentMode;
  cwd: string;
  yolo: boolean;
  maxTurns?: number;
  email?: string;
  prompt?: string;
  harnessId?: string;
  thinking?: ThinkingMode;
  /** Set when the user passed --think. */
  userPinnedThink?: boolean;
  /** Set when the user passed --model. */
  userPinnedModel?: boolean;
  profile?: 'coding' | 'pentest-eval';
  evalSession?: EvalSession;
  evalScope?: ScopeView;
  /** Broker work dir (audit + reports) for the eval session. */
  evalWorkDir?: string;
  /** Broker session id; reports land under <workDir>/reports/<id>/report.txt. */
  evalSessionId?: string;
  sourceRoot?: string;
  /** Customer / test scope brief already loaded into the planner prompt. */
  evalScopeBrief?: string;
  /** Path the brief was loaded from, if any. */
  evalScopeFile?: string;
  evalHistory?: AgentMessage[];
  evalCampaign?: string;
  evalTarget?: string;
  evalReopen?: (id: string) => Promise<SavedChat & { session: EvalSession; scope: ScopeView }>;
}

function write(s: string): void {
  process.stdout.write(s);
}

export async function runRepl(opts: ReplOptions): Promise<void> {
  disableMouseTracking();

  const configuredBaseUrl = opts.configuredBaseUrl || opts.baseUrl;
  let sessionBaseUrl = opts.baseUrl;
  let sessionApiKey = opts.apiKey;
  let apiModel = opts.apiModel || opts.model;
  let transport!: ModelTransport;

  const evalProfile = opts.profile === 'pentest-eval';
  // Per-turn sink for planner reasoning, so it renders in its own panel instead
  // of leaking into the reply. Set at the start of each eval turn.
  let onEvalReasoning: ((delta: string) => void) | undefined;
  const rebuildTransport = async (): Promise<void> => {
    if (evalProfile) {
      transport = openEvalTransport({ 'eval-url': sessionBaseUrl }, (d) => onEvalReasoning?.(d));
      return;
    }
    const apiBackend = isLabCatalogId(model)
      ? undefined
      : await resolveStackApiBackend(sessionBaseUrl);
    transport = openSessionTransport({
      apiKey: sessionApiKey,
      baseUrl: sessionBaseUrl,
      catalogId: model,
      apiModel,
      apiBackend,
    });
  };

  const attachModel = async (next: string): Promise<boolean> => {
    if (evalProfile) {
      model = next;
      apiModel = next;
      await rebuildTransport();
      return true;
    }
    if (!isLabCatalogId(next)) {
      sessionBaseUrl = configuredBaseUrl;
      sessionApiKey = opts.apiKey;
      apiModel = next;
      model = next;
      await rebuildTransport();
      return true;
    }
    try {
      const pin = await resolveLabPinTarget({
        catalogId: next,
        configuredBaseUrl,
        apiKey: opts.apiKey,
      });
      sessionBaseUrl = pin.baseUrl;
      apiModel = pin.apiModel;
      model = next;
      sessionApiKey = pin.kind === 'ollama' ? opts.apiKey || '' : opts.apiKey;
      await rebuildTransport();
      if (pin.kind === 'ollama') {
        write(renderHint(`lab → ${apiModel} @ ${sessionBaseUrl}`));
      }
      return true;
    } catch (err) {
      write(renderError(err instanceof Error ? err.message : String(err)));
      return false;
    }
  };

  const history: AgentMessage[] = [...(opts.evalHistory || [])];
  let evalSession = opts.evalSession;
  let evalWorkDir = opts.evalWorkDir;
  let evalSessionId = opts.evalSessionId;
  let evalScope = opts.evalScope;

  const registry = new ToolRegistry();
  if (evalProfile) {
    registerEvalTools(registry, () => evalSession, opts.sourceRoot || opts.cwd, opts.evalWorkDir);
  } else {
    registerCliTools(registry);
  }

  if (evalProfile && evalWorkDir) setEvalActivityDir(evalWorkDir);

  const persistEval = (): void => {
    if (!evalProfile || !evalWorkDir || !evalSessionId) return;
    try {
      saveEvalChat({
        work: evalWorkDir,
        cwd: opts.cwd,
        sessionId: evalSessionId,
        campaign: opts.evalCampaign || String(evalScope?.campaign_id || ''),
        target: opts.evalTarget || String(evalScope?.target_id || ''),
        model,
        history,
      });
    } catch {
      /* archive is best-effort */
    }
  };

  let mode = opts.mode;
  let yolo = opts.yolo;
  let thinking: ThinkingMode =
    opts.thinking ??
    (evalProfile || opts.userPinnedModel ? resolveInitialThinkingMode() : 'off');
  let model = opts.model || (evalProfile ? DEFAULT_EVAL_PLANNER : DEFAULT_MODEL);
  let evalScopeBrief = opts.evalScopeBrief || '';
  let evalScopeFile = opts.evalScopeFile || '';
  await rebuildTransport();
  let pinLocked = false;
  let autoPicked = !opts.userPinnedModel && isAutoModelId(model);
  let userPinnedThink = Boolean(opts.userPinnedThink);
  let skillIds: string[] = [];
  let skillBodies: string[] = [];
  if (evalProfile) {
    const defaults = await loadDefaultEvalSkills();
    skillIds = defaults.ids;
    skillBodies = defaults.bodies;
  }
  let turns = 0;
  let shouldExit = false;
  let turnAbort: AbortController | undefined;
  let stackModels: ModelPreset[] | null = null;
  const permissions = new PermissionMemory();

  const loadStackModels = async (): Promise<ModelPreset[]> => {
    if (evalProfile) {
      stackModels = EVAL_PLANNER_PRESETS;
      return stackModels;
    }
    if (stackModels) return stackModels;
    stackModels = await fetchStackModels({
      apiKey: sessionApiKey,
      baseUrl: sessionBaseUrl,
    });
    return stackModels;
  };

  const exitGuard = new DoublePressExit(write);

  const state = (): SessionUiState => ({
    model,
    mode,
    yolo,
    thinking,
    autoPicked: autoPicked && !pinLocked,
    cwd: opts.cwd,
    email: opts.email,
    baseUrl: sessionBaseUrl,
    turns,
    harnessId: opts.harnessId,
    skillIds,
    evalMode: evalProfile,
  });

  /** @returns true if caller should exit */
  async function handleInterrupt(key: ExitKey): Promise<boolean> {
    turnAbort?.abort();
    if (exitGuard.press(key)) {
      shouldExit = true;
      exitGuard.dispose();
      return true;
    }
    return false;
  }

  const readLine = () =>
    readLineRaw({
      onInterrupt: handleInterrupt,
      shouldExit: () => shouldExit,
    });

  const confirm = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<boolean> => {
    if (shouldExit) return false;
    return confirmOnce(permissions, name, args, async (shown, grantedArgs) => {
      write(renderPermissionRequest(shown, grantedArgs));
      write(
        `  ${ansi.dim('Allow?')} ${ansi.green('[y]')} ${ansi.dim('/')} ${ansi.red('[N]')} ${ansi.accent('❯')} `,
      );
      const ans = await readLine();
      if (ans === 'exit' || ans === 'retry' || shouldExit) return false;
      return /^y(es)?$/i.test(ans.trim());
    });
  };

  const pickMode = async (): Promise<void> => {
    const next = await pickFromList({
      title: 'Mode',
      current: mode,
      items: [
        {
          value: 'build',
          label: 'build / agent',
          hint: 'edit files · run tools',
        },
        {
          value: 'plan',
          label: 'plan / ask',
          hint: 'read-only',
        },
      ],
    });
    if (!next) return;
    mode = next as AgentMode;
    if (mode === 'ask' || mode === 'plan') yolo = false;
    write(renderHint(`Mode → ${mode}`));
  };

  const pickPerm = async (): Promise<void> => {
    const current = yolo && mode === 'agent' ? 'run-all' : 'ask';
    const next = await pickFromList({
      title: 'Permissions',
      current,
      items: [
        {
          value: 'ask',
          label: 'ask',
          hint: 'confirm before tools',
        },
        {
          value: 'run-all',
          label: 'run all',
          hint: 'skip confirms (yolo)',
        },
      ],
    });
    if (!next) return;
    if (next === 'run-all') {
      if (mode === 'ask') mode = 'agent';
      yolo = true;
      write(renderHint('Permissions → run all'));
    } else {
      yolo = false;
      write(renderHint('Permissions → ask'));
    }
  };

  const pickModel = async (): Promise<void> => {
    let items: ModelPreset[];
    try {
      items = await loadStackModels();
    } catch (err) {
      write(renderError(err instanceof Error ? err.message : String(err)));
      return;
    }
    if (!items.length) {
      write(renderHint('No models returned from this stack.'));
      return;
    }
    if (evalProfile) {
      const next = await pickFromList({
        title: 'Planner',
        current: model,
        items: items.map((p) => ({
          value: p.id,
          label: p.id,
          hint: p.blurb,
        })),
      });
      if (next) {
        await attachModel(next);
        persistEval();
        write(renderHint(`Planner → ${next}`));
      }
      return;
    }
    const catalog = codingPickerItems();
    const live = new Map(items.map((p) => [p.id.toLowerCase(), p]));
    const pickerItems: Array<{
      value: string;
      label: string;
      hint?: string;
      header?: boolean;
    }> = [];
    let lastSection = '';
    for (const row of catalog) {
      if (row.section !== lastSection) {
        lastSection = row.section;
        if (row.section === 'prod') {
          pickerItems.push({
            value: '__hdr_prod',
            label: 'Coding pins',
            header: true,
          });
        } else if (row.section === 'lab') {
          pickerItems.push({
            value: '__hdr_lab',
            label: 'Lab models',
            header: true,
          });
        }
      }
      const liveHit = live.get(row.id.toLowerCase());
      pickerItems.push({
        value: row.id,
        label:
          modelLabel(row.id) === row.id
            ? row.id
            : `${modelLabel(row.id)} (${row.id})`,
        hint: liveHit?.blurb || row.blurb,
      });
    }
    if (pinLocked) {
      write(renderHint('Model pin is locked for this session (first write).'));
      return;
    }
    const next = await pickFromList({
      title: `Model  ${ansi.dim(sessionBaseUrl)}`,
      current: model,
      items: pickerItems,
    });
    if (!next) return;
    if (!(await attachModel(next))) return;
    autoPicked = isAutoModelId(next);
    write(renderHint(`Model → ${modelLabel(model)}`));
  };

  const askBoxed = async (): Promise<string | null> => {
    while (!shouldExit) {
      if (exitGuard.isArmed()) {
        await exitGuard.waitUntilClear();
        if (shouldExit) return null;
      }

      const line = await readBoxedLine({
        state,
        onInterrupt: handleInterrupt,
        shouldExit: () => shouldExit,
      });
      if (line === 'exit' || shouldExit) return null;
      if (line === 'retry') {
        await exitGuard.waitUntilClear();
        if (shouldExit) return null;
        write('\n');
        continue;
      }
      return line;
    }
    return null;
  };

  const runOnce = async (userText: string) => {
    if (evalProfile) appendEvalActivity({ kind: 'user', name: 'message', content: userText, ok: true });
    const prior = history.filter((m) => m.role !== 'system');
    prior.push({ role: 'user', content: userText });
    const md = new MarkdownStreamRenderer(write);
    turnAbort = new AbortController();
    const signal = turnAbort.signal;
    let headerWritten = false;
    let lastHeader = '';
    let evalAssistant = '';
    let evalReasoning = '';
    onEvalReasoning = evalProfile
      ? (delta) => {
          evalReasoning += delta;
          noteEvalThought(delta);
        }
      : undefined;
    if (evalProfile) clearEvalThoughts();
    const spinner = new Spinner('thinking');
    spinner.start();
    try {
      const agentsMd = await loadAgentsMd(opts.cwd);
      const textOf = (content: AgentMessage['content']): string =>
        typeof content === 'string' ? content : '';
      const plugin = evalProfile
        ? { ran: false as const, error: undefined as string | undefined }
        : await tryCliPlugin({
        cwd: opts.cwd,
        harnessFlag: opts.harnessId,
        baseUrl: sessionBaseUrl,
        apiKey: sessionApiKey,
        model,
        maxTurns: opts.maxTurns,
        signal,
        messages: prior.map((m) => ({
          role: m.role,
          content: textOf(m.content),
        })),
        onEvent: (ev) => {
          if (ev.type === 'text' && ev.content) {
            spinner.stop();
            if (!headerWritten) {
              write(renderAssistantStart(model));
              headerWritten = true;
            }
            md.push(ev.content);
          } else if (ev.type === 'error' && ev.message) {
            spinner.stop();
            write(renderError(ev.message));
          }
        },
      });
      if (plugin.error) {
        spinner.stop();
        write(renderError(plugin.error));
      }
      const updated = plugin.ran
        ? prior
        : await runAgentTurn({
        transport,
        registry,
        model,
        mode: evalProfile ? 'agent' : mode,
        thinking,
        userPinnedThink,
        messages: prior,
        cwd: opts.cwd,
        yolo: evalProfile ? false : yolo,
        maxTurns: opts.maxTurns,
        signal,
        allowCodingSpawn: evalProfile ? false : undefined,
        continueOnProse: evalProfile ? false : undefined,
        systemPrompt: evalProfile
          ? buildAgentPrompt(evalScope || {}, Boolean(opts.sourceRoot), evalScopeBrief)
          : undefined,
        agentsMd,
        skillBodies,
        permissions,
        confirm: yolo ? undefined : confirm,
        onEvent: (ev) => {
          if (ev.type === 'status' && ev.text.startsWith('auto → ')) {
            const m = /^auto → (\S+) think=(\S+)/.exec(ev.text);
            if (m) {
              model = m[1]!;
              if (isThinkingMode(m[2])) thinking = m[2];
              autoPicked = true;
            }
          }
          if (ev.type === 'model') {
            spinner.stop();
            const line = renderAssistantStart(ev.requested, ev.resolved);
            if (!headerWritten) {
              write(line);
              headerWritten = true;
              lastHeader = line;
            } else if (ev.resolved && line !== lastHeader && !pinLocked) {
              // Rewrite the header line once the worker is known
              write(`\x1b[1A\r\x1b[2K${line.replace(/^\n/, '')}`);
              lastHeader = line;
            }
          } else if (ev.type === 'text') {
            spinner.stop();
            if (evalProfile) {
              evalAssistant += ev.content;
            } else {
              if (!headerWritten) {
                write(renderAssistantStart(model));
                headerWritten = true;
              }
              md.push(ev.content);
            }
          } else if (ev.type === 'toolStart') {
            if (isWriteTool(ev.name)) pinLocked = true;
            spinner.stop();
            if (!headerWritten) {
              write(renderAssistantStart(model));
              headerWritten = true;
            }
            md.flush();
            const human = toolStatusLine(ev.name, ev.arguments);
            write(renderToolStart(human, ''));
            spinner.setLabel(human);
          } else if (ev.type === 'toolResult') {
            md.flush();
            write(
              renderToolResultCard(
                ev.name,
                ev.ok,
                ev.content || ev.error || '',
              ),
            );
            // Resume live status between tools (Cursor-like “Planning next moves”).
            spinner.setLabel('planning next moves');
            spinner.start();
          } else if (ev.type === 'agents') {
            const line = agentsStatusLine(ev.run);
            spinner.setLabel(line);
            spinner.start();
          } else if (ev.type === 'error') {
            spinner.stop();
            if (!headerWritten) {
              write(renderAssistantStart(model));
              headerWritten = true;
            }
            md.flush();
            write(renderError(ev.message));
          } else if (ev.type === 'done' && ev.cancelled) {
            spinner.stop();
            md.flush();
            write(renderHint('Cancelled.'));
          } else if (ev.type === 'done') {
            spinner.setLabel('wrapping up');
            spinner.stop();
          }
        },
      });
      if (evalProfile && evalReasoning.trim()) {
        spinner.stop();
        md.flush();
        write(renderReasoning(evalReasoning));
      }
      if (evalProfile && enforceObedience(evalAssistant, '')) {
        if (!headerWritten) {
          write(renderAssistantStart(model));
          headerWritten = true;
        }
        md.push(enforceObedience(evalAssistant, ''));
      }
      md.flush();
      if (!signal.aborted) {
        history.length = 0;
        history.push(...updated.filter((m) => m.role !== 'system'));
        if (evalProfile) {
          attachAssistantReasoning(history, evalReasoning);
          appendEvalActivity({
            kind: 'assistant',
            name: 'message',
            content: evalAssistant,
            arguments: evalReasoning ? { reasoning: evalReasoning } : undefined,
            ok: true,
          });
          for (let i = history.length - 1; i >= 0; i--) {
            const m = history[i];
            if (m.role === 'assistant' && typeof m.content === 'string' && m.content) {
              m.content = enforceObedience(m.content);
              break;
            }
          }
        }
        turns += 1;
        persistEval();
      }
    } catch (err) {
      spinner.stop();
      md.flush();
      if (signal.aborted || shouldExit) {
        write(renderHint('Cancelled.'));
        return;
      }
      write(renderError(err instanceof Error ? err.message : String(err)));
      throw err;
    } finally {
      spinner.stop();
      turnAbort = undefined;
    }
    write('\n');
  };

  const evalPaths = (): string => {
    if (!evalProfile || !evalWorkDir) return '';
    const lines = [`  ${ansi.dim('work dir')}  ${ansi.cyan(evalWorkDir)}`];
    if (evalSessionId) {
      lines.push(`  ${ansi.dim('session ')}  ${ansi.cyan(evalSessionId)}`);
      lines.push(
        `  ${ansi.dim('report  ')}  ${ansi.cyan(
          path.join(evalWorkDir, 'reports', evalSessionId, 'report.txt'),
        )}${ansi.dim(' (once submitted)')}`,
      );
    }
    lines.push(`  ${ansi.dim('audit   ')}  ${ansi.cyan(path.join(evalWorkDir, 'audit.jsonl'))}`);
    lines.push(`  ${ansi.dim('transcript')}  ${ansi.cyan(path.join(evalWorkDir, 'transcript.md'))}`);
    lines.push(`  ${ansi.dim('activity')}  ${ansi.cyan(path.join(evalWorkDir, 'activity.jsonl'))}`);
    if (evalScopeFile || evalScopeBrief) {
      const where = evalScopeFile || `${evalScopeBrief.length} chars`;
      lines.push(`  ${ansi.dim('scope   ')}  ${ansi.cyan(where)}`);
    }
    return `${lines.join('\n')}\n\n`;
  };

  if (opts.prompt) {
    write(renderBanner(state()));
    write(evalPaths());
    write(`${ansi.accent('❯')} ${opts.prompt}\n`);
    write(`${renderStatusLine(state())}\n`);
    await runOnce(opts.prompt);
    exitGuard.dispose();
    return;
  }

  write(renderBanner(state()));
  write(evalPaths());

  while (!shouldExit) {
    let line: string | null;
    try {
      line = await askBoxed();
    } catch {
      break;
    }
    if (line === null || shouldExit) break;
    const text = line.trim();
    if (!text) continue;
    if (text === '/exit' || text === '/quit') break;

    if (text === '/ask' || text === '/plan') {
      mode = text === '/plan' ? 'plan' : 'ask';
      yolo = false;
      write(renderHint(`Mode → ${mode} (read-only)`));
      continue;
    }
    if (text === '/agent' || text === '/build') {
      mode = text === '/build' ? 'build' : 'agent';
      write(renderHint(`Mode → ${yolo ? 'yolo' : mode}`));
      continue;
    }
    if (text === '/init') {
      const { initAgentsMd } = await import('@spockify/harness');
      const r = await initAgentsMd(opts.cwd);
      write(
        renderHint(
          r.created
            ? `Wrote ${r.path}`
            : `Already present: ${r.path} (use force via re-init later)`,
        ),
      );
      continue;
    }
    if (text === '/mode') {
      await pickMode();
      await pickPerm();
      continue;
    }
    if (text === '/yolo') {
      if (mode === 'ask' || mode === 'plan') {
        write(renderHint('Switch to /build or /agent first — plan/ask is read-only.'));
        continue;
      }
      yolo = !yolo;
      write(renderHint(yolo ? 'Permissions → run all' : 'Permissions → ask'));
      continue;
    }
    if (text === '/status') {
      write(renderStatusPanel(state()));
      continue;
    }
    if (text === '/clear') {
      history.length = 0;
      turns = 0;
      persistEval();
      write(renderHint('Conversation cleared.'));
      continue;
    }
    if (text === '/revoke') {
      permissions.revokeAll();
      write(renderHint('Session grants revoked.'));
      continue;
    }
    if (text === '/model' || text.startsWith('/model ')) {
      const arg = text.slice('/model'.length).trim();
      if (pinLocked) {
        write(renderHint('Model pin is locked for this session (first write).'));
        continue;
      }
      if (!arg || isModelMetaCommand(arg)) {
        await pickModel();
        continue;
      }
      let available: ModelPreset[] | undefined;
      try {
        available = await loadStackModels();
      } catch (err) {
        write(renderError(err instanceof Error ? err.message : String(err)));
        continue;
      }
      const resolved = resolveModelId(arg, available);
      if (!resolved) {
        write(renderHint(`Unknown model “${arg}”. Try /model`));
        continue;
      }
      if (!evalProfile && !isSelectableCodingId(resolved)) {
        write(
          renderHint(
            'Use Auto, gpt-oss-20b, gpt-oss-120b, or a Lab model id.',
          ),
        );
        continue;
      }
      if (!(await attachModel(resolved))) continue;
      autoPicked = isAutoModelId(resolved);
      persistEval();
      write(renderHint(`Model → ${modelLabel(model)}`));
      continue;
    }
    if (text === '/skill' || text.startsWith('/skill ')) {
      const names = text.slice('/skill'.length).trim().split(/\s+/).filter(Boolean);
      const all = evalProfile
        ? await loadEvalSkillPool(opts.cwd)
        : await loadSkills(path.join(opts.cwd, '.spockify/skills'));
      const picked = pickSkillsByName(all, names);
      skillIds = picked.map((s) => s.id);
      skillBodies = picked.map((s) => `### ${s.title}\n${s.body}`);
      write(
        renderHint(
          skillIds.length
            ? `Skills → ${skillIds.join(', ')} (max 2)`
            : evalProfile
              ? 'No matching skills under package skills/pentest-eval or .spockify/skills (max 2).'
              : 'No matching skills under .spockify/skills (max 2).',
        ),
      );
      continue;
    }
    if (text === '/help') {
      write(renderHelp(false, evalProfile));
      continue;
    }
    if (text === '/tools') {
      write(renderToolsList(registry.listAll()));
      continue;
    }
    if (evalProfile && (text === '/resume' || text.startsWith('/resume '))) {
      persistEval();
      const chats = listEvalChats(opts.cwd);
      if (!chats.length) {
        write(renderHint('no saved chats yet. Talk first, then /resume to pick one later.'));
        continue;
      }
      if (!opts.evalReopen) {
        write(renderHint('/resume is only available in this evaluation REPL.'));
        continue;
      }
      const picked = await pickFromList({
        title: 'Resume chat',
        current: evalSessionId,
        items: chats.map((c) => ({
          value: c.id,
          label: c.title,
          hint: formatChatHint(c),
        })),
      });
      if (!picked) continue;
      if (picked === evalSessionId) {
        write(renderHint('already on that chat'));
        continue;
      }
      try {
        const next = await opts.evalReopen(picked);
        await evalSession?.close().catch(() => undefined);
        evalSession = next.session;
        evalScope = next.scope;
        evalWorkDir = next.dir;
        evalSessionId = next.meta.sessionId;
        history.length = 0;
        history.push(...next.history);
        turns = history.filter((m) => m.role === 'user').length;
        if (next.meta.model && next.meta.model !== model) {
          await attachModel(next.meta.model);
        }
        write(
          renderHint(
            `resumed  ${next.meta.title}  (${next.history.length} messages)  session ${next.meta.sessionId}`,
          ),
        );
        write(evalPaths());
      } catch (err) {
        write(renderError(err instanceof Error ? err.message : String(err)));
      }
      continue;
    }
    if (
      evalProfile &&
      evalSession &&
      (text === '/score' ||
        text === '/findings' ||
        text.startsWith('/findings ') ||
        text === '/done' ||
        text === '/report' ||
        text.startsWith('/report ') ||
        text === '/expand' ||
        text === '/approve' ||
        text.startsWith('/approve ') ||
        text === '/kill')
    ) {
      try {
        logEvalOperator(text.split(/\s+/)[0] || text, text);
        if (text === '/score') {
          write(renderHint(await formatEvalScore(evalSession)));
        } else if (text === '/findings' || text.startsWith('/findings ')) {
          write(renderHint(await handleEvalFindings(evalSession, text.slice('/findings'.length).trim())));
        } else if (text === '/done') {
          if (!evalScope) {
            write(renderError('session is not started'));
          } else {
            write(renderHint('close-out turn…'));
            const updated = await runSubmitGate({
              session: evalSession,
              scope: evalScope,
              transport,
              model,
              cwd: opts.cwd,
              sourceRoot: opts.sourceRoot,
              workDir: evalWorkDir,
              messages: history,
            });
            history.length = 0;
            history.push(...updated.filter((message) => message.role !== 'system'));
            persistEval();
            write(renderHint(await handleEvalFindings(evalSession)));
          }
        } else if (text === '/report' || text.startsWith('/report ')) {
          write(renderHint(await submitEvalReport(evalSession, text.slice('/report'.length).trim(), evalWorkDir)));
          persistEval();
        } else if (text === '/expand') {
          write(renderHint(await expandEvalReport(evalSession, evalWorkDir)));
          persistEval();
        } else if (text === '/approve' || text.startsWith('/approve ')) {
          write(renderHint(await approveEvalPending(evalSession, text.slice('/approve'.length).trim())));
          persistEval();
        } else {
          await evalSession.request('kill');
          write(renderHint('session killed'));
        }
      } catch (err) {
        write(renderError(err instanceof Error ? err.message : String(err)));
      }
      continue;
    }
    if (evalProfile && (text === '/scope' || text.startsWith('/scope '))) {
      const arg = text.slice('/scope'.length).trim();
      try {
        if (!arg || arg === 'show') {
          if (!evalScopeBrief) {
            write(
              renderHint(
                'no extra scope brief. /scope <file> or --scope <file> injects a customer / test RoE into the planner prompt.',
              ),
            );
          } else {
            const head = evalScopeBrief.split('\n').slice(0, 8).join('\n');
            write(
              renderHint(
                `scope brief${evalScopeFile ? `  ${evalScopeFile}` : ''}  (${evalScopeBrief.length} chars)\n${head}${evalScopeBrief.split('\n').length > 8 ? '\n…' : ''}`,
              ),
            );
          }
        } else if (arg === 'clear') {
          evalScopeBrief = '';
          evalScopeFile = '';
          persistEval();
          write(renderHint('scope brief cleared (campaign scope from the broker stays)'));
        } else {
          const resolved = path.resolve(opts.cwd, arg);
          evalScopeBrief = loadScopeBrief(resolved);
          evalScopeFile = resolved;
          persistEval();
          write(
            renderHint(
              evalScopeBrief
                ? `scope brief → ${resolved} (${evalScopeBrief.length} chars; in planner context next turn)`
                : `${resolved} is empty`,
            ),
          );
        }
      } catch (err) {
        write(renderError(err instanceof Error ? err.message : String(err)));
      }
      continue;
    }
    if (evalProfile && evalSession && (text === '/autonomy' || text.startsWith('/autonomy '))) {
      const arg = text.slice('/autonomy'.length).trim().toUpperCase();
      try {
        if (!arg) {
          const scope = await evalSession.request('scope');
          write(
            renderHint(
              `autonomy → ${scope.autonomy_level ?? '—'}  (set with /autonomy L0|L1|L2|L3; L0 = full throughput)`,
            ),
          );
        } else if (!/^L[0-3]$/.test(arg)) {
          write(renderHint('Unknown level. Use L0 (full/throughput), L1, L2, or L3.'));
        } else {
          const reply = await evalSession.request('set_autonomy', { level: arg });
          const applied = String(reply.autonomy_level ?? arg);
          if (evalScope) evalScope.autonomy_level = applied;
          persistEval();
          write(
            renderHint(
              applied === 'L0'
                ? 'autonomy → L0 (full throughput — nothing queues; audit stays on, reports auto-submit)'
                : `autonomy → ${applied}`,
            ),
          );
        }
      } catch (err) {
        write(renderError(err instanceof Error ? err.message : String(err)));
      }
      continue;
    }
    if (text === '/think' || text.startsWith('/think ')) {
      const arg = text.slice('/think'.length).trim().toLowerCase();
      if (!arg) {
        thinking = nextThinkingMode(thinking);
      } else if (isThinkingMode(arg)) {
        thinking = arg;
      } else {
        const normalized = normalizeThinkingMode(arg, thinking);
        if (normalized === thinking && arg !== normalized) {
          write(
            renderHint(
              `Unknown thinking “${arg}”. Use off, low, medium, high, or heavy.`,
            ),
          );
          continue;
        }
        thinking = normalized;
      }
      userPinnedThink = true;
      write(renderHint(`Thinking → ${thinkingModeLabel(thinking)}`));
      continue;
    }

    try {
      await runOnce(text);
    } catch {
      /* already printed */
    }
  }

  persistEval();
  exitGuard.dispose();
  write(renderGoodbye());
}
