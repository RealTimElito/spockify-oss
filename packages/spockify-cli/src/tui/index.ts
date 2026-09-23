import type { ModelTransport } from '@spockify/ide-client';
import {
  codingPickerItems,
  confirmOnce,
  formatSessionPin,
  isAutoModelId,
  isLabCatalogId,
  isWriteTool,
  PermissionMemory,
} from '@spockify/harness';
import {
  openSessionTransport,
  resolveLabPinTarget,
} from '../labPin';
import { runAgentTurn } from '../agent/loop';
import { ToolRegistry } from '../agent/registry';
import { registerCliTools } from '../agent/tools';
import { registerEvalTools } from '../pentestEval/tools';
import { isAllowAll } from '../pentestEval/execAllow';
import path from 'node:path';
import { buildAgentPrompt, loadScopeBrief } from '../pentestEval/prompt';
import { enforceObedience } from '../pentestEval/obey';
import { appendEvalActivity, clearEvalThoughts, logEvalOperator, noteEvalThought, setEvalActivityDir } from '../pentestEval/activity';
import { attachAssistantReasoning, saveEvalChat } from '../pentestEval/continue';
import { loadDefaultEvalSkills, runSubmitGate } from '../pentestEval/turn';
import { openEvalTransport } from '../pentestEval/evalTransport';
import type { EvalSession } from '../pentestEval/session';
import { approveEvalPending, expandEvalReport, formatEvalScore, handleEvalFindings, submitEvalReport } from '../pentestEval/operator';
import type { AgentMessage, AgentMode } from '../agent/types';
import { fetchStackModels, resolveStackApiBackend } from '../discover';
import type { ModelPreset } from '../models';
import { EVAL_PLANNER_PRESETS } from '../pentestEval/planner';
import { modelLabel, shortPath, ansi, agentsStatusLine, renderToolsList } from '../ui';
import {
  isThinkingMode,
  nextThinkingMode,
  normalizeThinkingMode,
  resolveInitialThinkingMode,
  thinkingModeLabel,
  type ThinkingMode,
} from '../thinking';
import { Frame, truncate, visLen } from './draw';
import {
  createInputParser,
  enterAltScreen,
  hideCursor,
  leaveAltScreen,
  termSize,
  type KeyEvent,
} from './terminal';

export interface TuiOptions {
  apiKey: string;
  baseUrl: string;
  configuredBaseUrl?: string;
  model: string;
  apiModel?: string;
  mode: AgentMode;
  cwd: string;
  yolo: boolean;
  maxTurns?: number;
  email?: string;
  harnessId?: string;
  thinking?: ThinkingMode;
  userPinnedThink?: boolean;
  userPinnedModel?: boolean;
  /** pentest-eval reuses this screen with the evaluation broker instead of coding tools. */
  profile?: 'coding' | 'pentest-eval';
  evalSession?: EvalSession;
  evalScope?: import('../pentestEval/prompt').ScopeView;
  sourceRoot?: string;
  evalScopeBrief?: string;
  evalScopeFile?: string;
  evalWorkDir?: string;
  evalSessionId?: string;
  evalCampaign?: string;
  evalTarget?: string;
}

type LogLine = {
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  text: string;
  meta?: string;
};

type Modal =
  | null
  | { kind: 'settings' }
  | { kind: 'model'; idx: number }
  | { kind: 'mode'; idx: number }
  | { kind: 'perm'; idx: number }
  | { kind: 'confirm'; title: string; body: string };

export async function runTui(opts: TuiOptions): Promise<void> {
  const configuredBaseUrl = opts.configuredBaseUrl || opts.baseUrl;
  let sessionBaseUrl = opts.baseUrl;
  let sessionApiKey = opts.apiKey;
  let apiModel = opts.apiModel || opts.model;
  let transport: ModelTransport;
  let model = opts.model;

  let onEvalReasoning: ((delta: string) => void) | undefined;
  const rebuildTransport = async (): Promise<void> => {
    if (opts.profile === 'pentest-eval') {
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

  await rebuildTransport();
  const registry = new ToolRegistry();
  const evalProfile = opts.profile === 'pentest-eval';
  let evalScopeBrief = opts.evalScopeBrief || '';
  let evalScopeFile = opts.evalScopeFile || '';
  if (evalProfile) {
    registerEvalTools(registry, opts.evalSession, opts.sourceRoot || opts.cwd, opts.evalWorkDir);
  } else {
    registerCliTools(registry);
  }
  let mode: AgentMode = opts.mode;
  let yolo = opts.yolo;
  let thinking: ThinkingMode =
    opts.thinking ??
    (evalProfile || opts.userPinnedModel ? resolveInitialThinkingMode() : 'off');
  let pinLocked = false;
  let autoPicked = !opts.userPinnedModel && isAutoModelId(model);
  let userPinnedThink = Boolean(opts.userPinnedThink);
  let turns = 0;
  let input = '';
  let log: LogLine[] = [];
  let scroll = 0; // lines from bottom (0 = pinned to end)
  let modal: Modal = null;
  let running = false;
  let shouldExit = false;
  let frame: Frame | null = null;
  let dirty = true;
  let turnAbort: AbortController | undefined;
  let confirmResolve: ((ok: boolean) => void) | null = null;
  const history: AgentMessage[] = [];
  let stackModels: ModelPreset[] = [];
  let skillBodies: string[] = [];
  if (evalProfile) {
    skillBodies = (await loadDefaultEvalSkills()).bodies;
  }
  const permissions = new PermissionMemory();
  if (evalProfile && opts.evalWorkDir) setEvalActivityDir(opts.evalWorkDir);

  const persistEval = (): void => {
    if (!evalProfile || !opts.evalWorkDir || !opts.evalSessionId) return;
    try {
      saveEvalChat({
        work: opts.evalWorkDir,
        cwd: opts.cwd,
        sessionId: opts.evalSessionId,
        campaign: opts.evalCampaign || String(opts.evalScope?.campaign_id || ''),
        target: opts.evalTarget || String(opts.evalScope?.target_id || ''),
        model,
        history,
      });
    } catch {
      /* archive is best-effort */
    }
  };

  const size = () => termSize();

  const markDirty = () => {
    dirty = true;
  };

  const ensureStackModels = async (): Promise<ModelPreset[]> => {
    if (opts.profile === 'pentest-eval') {
      stackModels = EVAL_PLANNER_PRESETS;
      return stackModels;
    }
    if (stackModels.length) return stackModels;
    try {
      stackModels = await fetchStackModels({
        apiKey: sessionApiKey,
        baseUrl: sessionBaseUrl,
      });
    } catch (err) {
      pushLog({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      stackModels = [];
    }
    const live = new Map(stackModels.map((p) => [p.id.toLowerCase(), p]));
    stackModels = codingPickerItems().map((row) => ({
      id: row.id,
      aliases: [],
      blurb: live.get(row.id.toLowerCase())?.blurb || row.blurb,
    }));
    return stackModels;
  };

  const pushLog = (line: LogLine) => {
    log.push(line);
    markDirty();
  };
  if (evalProfile) {
    pushLog({
      kind: 'system',
      text: opts.sourceRoot
        ? `Tools: eval_scope, eval_list, eval_glob, eval_read_file, eval_search, eval_write_file, eval_exec (${isAllowAll() ? 'ALLOW_ALL' : 'ls/cat/grep/cd'}), eval_status, eval_health, eval_list_findings, eval_evidence_tokens, eval_submit_finding, eval_submit_report, eval_propose, eval_pin_endpoint, eval_connect. Tree: ${opts.sourceRoot}`
        : 'Tools: eval_scope, eval_status, eval_health, eval_list_findings, eval_evidence_tokens, eval_submit_finding, eval_submit_report, eval_propose, eval_pin_endpoint, eval_connect.',
    });
  }

  const attachModel = async (next: string): Promise<boolean> => {
    if (opts.profile === 'pentest-eval') {
      model = next;
      apiModel = next;
      await rebuildTransport();
      pushLog({ kind: 'system', text: `planner → ${next}` });
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
        pushLog({
          kind: 'system',
          text: `lab → ${apiModel} @ ${sessionBaseUrl}`,
        });
      }
      return true;
    } catch (err) {
      pushLog({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };

  const wrap = (text: string, width: number): string[] => {
    if (width < 8) return [truncate(text, width)];
    const words = text.split(/(\s+)/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (visLen(cur) + visLen(w) <= width) {
        cur += w;
      } else {
        if (cur) lines.push(cur);
        cur = w.trimStart();
        while (visLen(cur) > width) {
          lines.push(cur.slice(0, width));
          cur = cur.slice(width);
        }
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  const render = () => {
    const { cols, rows } = size();
    if (!frame || frame.cols !== cols || frame.rows !== rows) {
      frame = new Frame(cols, rows);
    }
    frame.clear();

    // Keep sidebar wide enough that labels/values aren't clipped
    const sideW = Math.min(32, Math.max(26, Math.floor(cols * 0.3)));
    const chatW = Math.max(24, cols - sideW);
    const headerH = 1;
    const inputH = 3;
    const chatH = Math.max(6, rows - headerH - inputH);
    const sx = chatW;
    const iy = headerH + chatH;

    const modeVal = mode === 'ask' ? 'ask' : 'agent';
    const permVal = yolo && mode === 'agent' ? 'run all' : 'ask';

    // Header bar
    frame.fill(0, 0, cols, 1);
    frame.text(
      0,
      0,
      `${ansi.accent(ansi.bold(' Spockify'))}${ansi.dim(' TUI')}`,
    );
    const statusBits = formatSessionPin({
      harnessId: opts.harnessId,
      model,
      thinking,
      auto: autoPicked && !pinLocked,
    });
    frame.text(16, 0, ansi.cyan(statusBits));
    const right = running ? ansi.yellow(' thinking… ') : ansi.dim(' idle ');
    frame.text(Math.max(0, cols - visLen(right) - 1), 0, right);

    // Chat panel
    frame.box(0, headerH, chatW, chatH, { title: 'chat', focus: !modal });
    const innerW = chatW - 4;
    const innerH = chatH - 2;
    const wrapped: string[] = [];
    if (log.length === 0) {
      wrapped.push(
        ansi.dim('Type a message · /help · click sidebar to change settings'),
      );
    }
    for (const line of log) {
      if (line.kind === 'user') {
        for (const b of wrap(`❯ ${line.text}`, innerW)) {
          wrapped.push(ansi.accent(b));
        }
      } else if (line.kind === 'assistant') {
        if (line.meta) {
          wrapped.push(ansi.dim(truncate(line.meta, innerW)));
        }
        for (const b of wrap(line.text, innerW)) {
          wrapped.push(b);
        }
        wrapped.push(''); // breathing room after replies
      } else if (line.kind === 'tool') {
        for (const b of wrap(`⚙ ${line.text}`, innerW)) {
          wrapped.push(ansi.dim(b));
        }
      } else if (line.kind === 'error') {
        for (const b of wrap(`✘ ${line.text}`, innerW)) {
          wrapped.push(ansi.red(b));
        }
      } else {
        for (const b of wrap(line.text, innerW)) {
          wrapped.push(ansi.dim(b));
        }
      }
    }
    const maxScroll = Math.max(0, wrapped.length - innerH);
    scroll = Math.min(scroll, maxScroll);
    const start = Math.max(0, wrapped.length - innerH - scroll);
    const slice = wrapped.slice(start, start + innerH);
    for (let i = 0; i < slice.length; i++) {
      frame.text(2, headerH + 1 + i, truncate(slice[i]!, innerW), innerW);
    }
    if (maxScroll > 0) {
      const hint = scroll > 0 ? `↑${scroll}` : '↓';
      frame.text(chatW - 4, headerH + chatH - 2, ansi.dim(hint), 3);
    }

    // Sidebar — one row per setting, clickable
    frame.box(sx, headerH, sideW, chatH, { title: 'session' });
    const contentW = sideW - 4;
    const rowsSide: Array<{
      id: string;
      label: string;
      value: string;
      color: (s: string) => string;
      clickable: boolean;
    }> = [
      {
        id: 'hit:model',
        label: 'model',
        value: modelLabel(model),
        color: ansi.cyan,
        clickable: true,
      },
      {
        id: 'hit:mode',
        label: 'mode',
        value: modeVal,
        color: mode === 'ask' ? ansi.blue : ansi.magenta,
        clickable: true,
      },
      {
        id: 'hit:perm',
        label: 'perm',
        value: permVal,
        color: yolo && mode === 'agent' ? ansi.yellow : ansi.dim,
        clickable: true,
      },
      {
        id: 'hit:think',
        label: 'think',
        value: thinkingModeLabel(thinking),
        color: thinking === 'off' ? ansi.dim : ansi.magenta,
        clickable: true,
      },
      {
        id: 'hit:email',
        label: 'user',
        value: opts.email || 'api-key',
        color: ansi.green,
        clickable: false,
      },
    ];

    let sy = headerH + 2;
    for (const r of rowsSide) {
      if (sy >= headerH + chatH - 6) break;
      frame.text(sx + 2, sy, ansi.dim(r.label), contentW);
      const val = truncate(r.value, contentW - (r.clickable ? 2 : 0));
      const line = r.clickable
        ? ansi.accent('▸ ') + r.color(val)
        : r.color(val);
      frame.text(sx + 2, sy + 1, line, contentW);
      if (r.clickable) {
        frame.hit(r.id, sx + 1, sy, sideW - 2, 2);
      }
      sy += 3;
    }

    // cwd
    if (sy < headerH + chatH - 5) {
      frame.text(sx + 2, sy, ansi.dim('cwd'), contentW);
      frame.text(
        sx + 2,
        sy + 1,
        ansi.dim(truncate(shortPath(opts.cwd, contentW), contentW)),
        contentW,
      );
      sy += 3;
    }

    // Sidebar actions
    const f = frame;
    const btnY = Math.max(sy + 1, headerH + chatH - 5);
    const btn = (id: string, y: number, label: string) => {
      if (y >= headerH + chatH - 1) return;
      const t = truncate(label, contentW - 2);
      f.text(sx + 2, y, ansi.accent(`[ ${t} ]`), contentW);
      f.hit(id, sx + 2, y, contentW, 1);
    };
    btn('hit:settings', btnY, 'settings  s');
    btn('hit:clear', btnY + 1, 'clear');
    btn('hit:quit', btnY + 2, 'quit  q');

    // Input bar — full width, accent when focused
    frame.box(0, iy, cols, inputH, {
      title: running ? 'working' : 'message',
      focus: !modal && !running,
    });
    const prompt = running ? ansi.dim('  … ') : ansi.accent('  ❯ ');
    const maxIn = cols - 8;
    const shown =
      input.length > maxIn ? `…${input.slice(-(maxIn - 1))}` : input;
    frame.text(1, iy + 1, prompt + shown, cols - 2);
    frame.text(
      Math.max(2, cols - 22),
      iy + 2,
      ansi.dim('enter send · /help'),
      20,
    );

    if (modal) {
      drawModal(frame, cols, rows, modal, model, mode, yolo, stackModels);
      hideCursor();
    } else {
      hideCursor();
    }

    frame.flush();
  };

  const openSettings = () => {
    modal = { kind: 'settings' };
    markDirty();
  };

  const openModel = () => {
    if (pinLocked) {
      pushLog({
        kind: 'system',
        text: 'Model pin is locked for this session (first write).',
      });
      return;
    }
    void (async () => {
      const models = await ensureStackModels();
      if (!models.length) {
        markDirty();
        return;
      }
      const idx = Math.max(
        0,
        models.findIndex((p) => p.id === model),
      );
      modal = { kind: 'model', idx };
      markDirty();
    })();
  };

  const openMode = () => {
    modal = { kind: 'mode', idx: mode === 'ask' ? 1 : 0 };
    markDirty();
  };

  const openPerm = () => {
    modal = {
      kind: 'perm',
      idx: yolo && mode === 'agent' ? 1 : 0,
    };
    markDirty();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    if (text === '/q' || text === '/quit' || text === '/exit') {
      shouldExit = true;
      return;
    }
    if (text === '/settings' || text === '/s') {
      input = '';
      openSettings();
      return;
    }
    if (text === '/tools') {
      input = '';
      const listing = renderToolsList(registry.listAll());
      for (const line of listing.split('\n')) {
        if (line.trim()) pushLog({ kind: 'system', text: line.trim() });
      }
      return;
    }
    if (text === '/help' || text === '/?') {
      input = '';
      pushLog({
        kind: 'system',
        text: 'Keys: enter send · s settings · ↑↓/PgUp/PgDn scroll · q quit · esc close · click ▸ sidebar',
      });
      pushLog({
        kind: 'system',
        text: evalProfile
          ? 'Commands: /help · /tools · /think · /scope · /score · /findings · /done · /report · /expand · /approve · /kill · /clear · /exit · click model or think in the sidebar'
          : 'Commands: /help · /tools · /think · /settings · /clear · /revoke · /exit · or click model/mode/perm/think',
      });
      return;
    }
    if (text === '/think' || text.startsWith('/think ')) {
      input = '';
      const arg = text.slice('/think'.length).trim().toLowerCase();
      if (!arg) {
        thinking = nextThinkingMode(thinking);
      } else if (isThinkingMode(arg)) {
        thinking = arg;
      } else {
        const normalized = normalizeThinkingMode(arg, thinking);
        if (normalized === thinking && arg !== normalized) {
          pushLog({
            kind: 'system',
            text: `Unknown thinking “${arg}”. Use off, low, medium, high, or heavy.`,
          });
          markDirty();
          return;
        }
        thinking = normalized;
      }
      userPinnedThink = true;
      pushLog({ kind: 'system', text: `Thinking → ${thinkingModeLabel(thinking)}` });
      markDirty();
      return;
    }
    if (evalProfile && (text === '/scope' || text.startsWith('/scope '))) {
      input = '';
      const arg = text.slice('/scope'.length).trim();
      try {
        if (!arg || arg === 'show') {
          pushLog({
            kind: 'system',
            text: evalScopeBrief
              ? `scope brief${evalScopeFile ? `  ${evalScopeFile}` : ''}  (${evalScopeBrief.length} chars)`
              : 'no extra scope brief. /scope <file> or --scope <file> injects a customer / test RoE.',
          });
        } else if (arg === 'clear') {
          evalScopeBrief = '';
          evalScopeFile = '';
          pushLog({ kind: 'system', text: 'scope brief cleared (campaign scope from the broker stays)' });
        } else {
          const resolved = path.resolve(opts.cwd, arg);
          evalScopeBrief = loadScopeBrief(resolved);
          evalScopeFile = resolved;
          pushLog({
            kind: 'system',
            text: evalScopeBrief
              ? `scope brief → ${resolved} (${evalScopeBrief.length} chars)`
              : `${resolved} is empty`,
          });
        }
      } catch (err) {
        pushLog({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      }
      markDirty();
      return;
    }
    if (
      evalProfile &&
      opts.evalSession &&
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
      input = '';
      try {
        logEvalOperator(text.split(/\s+/)[0] || text, text);
        if (text === '/score') {
          pushLog({ kind: 'system', text: await formatEvalScore(opts.evalSession) });
        } else if (text === '/findings' || text.startsWith('/findings ')) {
          pushLog({
            kind: 'system',
            text: await handleEvalFindings(opts.evalSession, text.slice('/findings'.length).trim()),
          });
        } else if (text === '/done') {
          if (!opts.evalScope || !transport) {
            pushLog({ kind: 'error', text: 'session or transport is not ready' });
          } else {
            pushLog({ kind: 'system', text: 'close-out turn…' });
            const updated = await runSubmitGate({
              session: opts.evalSession,
              scope: opts.evalScope,
              transport,
              model,
              cwd: opts.cwd,
              sourceRoot: opts.sourceRoot,
              workDir: opts.evalWorkDir,
              messages: history,
            });
            history.length = 0;
            history.push(...updated.filter((message) => message.role !== 'system'));
            persistEval();
            pushLog({ kind: 'system', text: await handleEvalFindings(opts.evalSession) });
          }
        } else if (text === '/report' || text.startsWith('/report ')) {
          pushLog({
            kind: 'system',
            text: await submitEvalReport(opts.evalSession, text.slice('/report'.length).trim(), opts.evalWorkDir),
          });
          persistEval();
        } else if (text === '/expand') {
          pushLog({
            kind: 'system',
            text: await expandEvalReport(opts.evalSession, opts.evalWorkDir),
          });
          persistEval();
        } else if (text === '/approve' || text.startsWith('/approve ')) {
          pushLog({
            kind: 'system',
            text: await approveEvalPending(opts.evalSession, text.slice('/approve'.length).trim()),
          });
        } else {
          await opts.evalSession.request('kill');
          pushLog({ kind: 'system', text: 'session killed' });
        }
      } catch (err) {
        pushLog({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      }
      markDirty();
      return;
    }
    if (text === '/clear') {
      input = '';
      log = [];
      history.length = 0;
      turns = 0;
      markDirty();
      return;
    }
    if (text === '/revoke') {
      input = '';
      permissions.revokeAll();
      pushLog({ kind: 'system', text: 'Session grants revoked.' });
      markDirty();
      return;
    }
    input = '';
    if (evalProfile) appendEvalActivity({ kind: 'user', name: 'message', content: text, ok: true });
    pushLog({ kind: 'user', text });
    running = true;
    markDirty();
    turnAbort = new AbortController();
    const prior = history.filter((m) => m.role !== 'system');
    prior.push({ role: 'user', content: text });
    let assistantBuf = '';
    let headerMeta = '';
    let evalReasoning = '';
    onEvalReasoning = evalProfile
      ? (delta) => {
          evalReasoning += delta;
          noteEvalThought(delta);
        }
      : undefined;
    if (evalProfile) clearEvalThoughts();
    // Start a fresh assistant bubble
    pushLog({ kind: 'assistant', text: '', meta: '' });
    try {
      const updated = await runAgentTurn({
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
        signal: turnAbort.signal,
        permissions,
        systemPrompt: evalProfile
          ? buildAgentPrompt(opts.evalScope || {}, Boolean(opts.sourceRoot), evalScopeBrief)
          : undefined,
        skillBodies: evalProfile ? skillBodies : undefined,
        allowCodingSpawn: evalProfile ? false : undefined,
        continueOnProse: evalProfile ? false : undefined,
        confirm: async (name, args) => {
          if (mode === 'ask') return false;
          if (yolo) return true;
          return confirmOnce(permissions, name, args, async (shown, grantedArgs) => {
            const preview = formatToolPreview(shown, grantedArgs);
            return await new Promise<boolean>((resolve) => {
              confirmResolve = resolve;
              modal = {
                kind: 'confirm',
                title: `Allow ${shown}?`,
                body: preview,
              };
              markDirty();
            });
          });
        },
        onEvent: (ev) => {
          if (ev.type === 'status' && ev.text.startsWith('auto → ')) {
            const m = /^auto → (\S+) think=(\S+)/.exec(ev.text);
            if (m) {
              model = m[1]!;
              if (isThinkingMode(m[2])) thinking = m[2];
              autoPicked = true;
              headerMeta = ev.text;
              markDirty();
            }
          }
          if (ev.type === 'model') {
            headerMeta =
              ev.resolved && ev.resolved !== ev.requested
                ? `auto → ${modelLabel(ev.resolved)} think=${thinking}`
                : formatSessionPin({
                    harnessId: opts.harnessId,
                    model: ev.requested,
                    thinking,
                    auto: autoPicked && !pinLocked,
                  });
          } else if (ev.type === 'text') {
            assistantBuf += ev.content;
            const last = log[log.length - 1];
            if (last?.kind === 'assistant') {
              last.text = assistantBuf;
              last.meta = headerMeta || last.meta;
              markDirty();
            } else {
              pushLog({
                kind: 'assistant',
                text: assistantBuf,
                meta: headerMeta,
              });
            }
          } else if (ev.type === 'toolStart') {
            if (isWriteTool(ev.name)) pinLocked = true;
            pushLog({
              kind: 'tool',
              text: formatToolPreview(ev.name, ev.arguments),
            });
          } else if (ev.type === 'toolResult') {
            const snippet = (ev.content || ev.error || '')
              .replace(/\s+/g, ' ')
              .slice(0, 120);
            pushLog({
              kind: 'tool',
              text: `${ev.name} → ${ev.ok ? 'ok' : 'err'}${snippet ? `: ${snippet}` : ''}`,
            });
          } else if (ev.type === 'agents') {
            pushLog({
              kind: 'tool',
              text: agentsStatusLine(ev.run),
            });
          } else if (ev.type === 'error') {
            pushLog({ kind: 'error', text: ev.message });
          }
        },
      });
      history.length = 0;
      history.push(...updated.filter((m) => m.role !== 'system'));
      if (evalProfile) {
        attachAssistantReasoning(history, evalReasoning);
        appendEvalActivity({
          kind: 'assistant',
          name: 'message',
          content: assistantBuf,
          arguments: evalReasoning ? { reasoning: evalReasoning } : undefined,
          ok: true,
        });
        persistEval();
        for (let i = history.length - 1; i >= 0; i--) {
          const m = history[i];
          if (m.role === 'assistant' && m.content) {
            const cleaned = enforceObedience(m.content);
            if (cleaned !== m.content) {
              m.content = cleaned;
              for (let j = log.length - 1; j >= 0; j--) {
                if (log[j].kind === 'assistant') {
                  log[j].text = cleaned;
                  markDirty();
                  break;
                }
              }
            }
            break;
          }
        }
      }
      turns += 1;
    } catch (err) {
      if (!turnAbort.signal.aborted) {
        pushLog({
          kind: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      running = false;
      turnAbort = undefined;
      markDirty();
    }
  };

  const onKey = async (ev: KeyEvent) => {
    if (ev.type === 'resize') {
      markDirty();
      return;
    }

    if (ev.type === 'mouse') {
      const { mouse } = ev;
      if (mouse.release) return;
      if (!frame) return;
      // scroll wheel (SGR button 64/65)
      if (mouse.button === 64) {
        scroll += 3;
        markDirty();
        return;
      }
      if (mouse.button === 65) {
        scroll = Math.max(0, scroll - 3);
        markDirty();
        return;
      }
      if (mouse.button !== 0 && mouse.button !== 32) return;
      const hit = frame.hitTest(mouse.col, mouse.row);
      if (!hit) return;
      if (modal) {
        handleModalHit(hit);
        return;
      }
      if (hit === 'hit:settings') openSettings();
      else if (hit === 'hit:model') openModel();
      else if (hit === 'hit:mode') openMode();
      else if (hit === 'hit:perm') openPerm();
      else if (hit === 'hit:think') {
        thinking = nextThinkingMode(thinking);
        userPinnedThink = true;
        pushLog({ kind: 'system', text: `Thinking → ${thinkingModeLabel(thinking)}` });
        markDirty();
      }
      else if (hit === 'hit:clear') {
        log = [{ kind: 'system', text: 'Chat cleared.' }];
        history.length = 0;
        turns = 0;
        markDirty();
      } else if (hit === 'hit:quit') {
        shouldExit = true;
      } else if (hit.startsWith('modal:')) {
        handleModalHit(hit);
      }
      return;
    }

    const { key, ctrl } = ev;
    if (ctrl && key === 'c') {
      if (running) {
        turnAbort?.abort();
        pushLog({ kind: 'system', text: 'Cancelled.' });
        running = false;
        markDirty();
        return;
      }
      shouldExit = true;
      return;
    }

    if (modal) {
      handleModalKey(key);
      return;
    }

    if (key === 'escape') return;
    if (key === 'q' && input.length === 0) {
      shouldExit = true;
      return;
    }
    if (key === 's' && input.length === 0) {
      openSettings();
      return;
    }
    if (key === 'up' || key === 'pageup') {
      scroll += key === 'pageup' ? 10 : 1;
      markDirty();
      return;
    }
    if (key === 'down' || key === 'pagedown') {
      scroll = Math.max(0, scroll - (key === 'pagedown' ? 10 : 1));
      markDirty();
      return;
    }
    if (key === 'enter') {
      void send();
      return;
    }
    if (key === 'backspace') {
      input = input.slice(0, -1);
      markDirty();
      return;
    }
    if (key.length === 1 && !ctrl) {
      input += key;
      markDirty();
    }
  };

  const settleConfirm = (ok: boolean) => {
    if (confirmResolve) {
      confirmResolve(ok);
      confirmResolve = null;
    }
    modal = null;
    markDirty();
  };

  const handleModalHit = (hit: string) => {
    if (modal?.kind === 'confirm') {
      if (hit === 'modal:yes') settleConfirm(true);
      else if (hit === 'modal:no' || hit === 'modal:close') settleConfirm(false);
      return;
    }
    if (hit === 'modal:close') {
      modal = null;
      markDirty();
      return;
    }
    if (hit.startsWith('modal:pick:')) {
      const value = hit.slice('modal:pick:'.length);
      applyModalPick(value);
    }
    if (hit === 'modal:goto:model') openModel();
    if (hit === 'modal:goto:mode') openMode();
    if (hit === 'modal:goto:perm') openPerm();
  };

  const applyModalPick = (value: string) => {
    if (!modal) return;
    if (modal.kind === 'model') {
      void attachModel(value).then((ok) => {
        if (!ok) return;
        autoPicked = isAutoModelId(value);
        pushLog({ kind: 'system', text: `Model → ${modelLabel(model)}` });
        markDirty();
      });
    } else if (modal.kind === 'mode') {
      mode = value as AgentMode;
      if (mode === 'ask') yolo = false;
      pushLog({
        kind: 'system',
        text: `Mode → ${mode === 'ask' ? 'ask mode' : 'agent mode'}`,
      });
    } else if (modal.kind === 'perm') {
      if (value === 'run-all') {
        mode = 'agent';
        yolo = true;
      } else {
        yolo = false;
      }
      pushLog({
        kind: 'system',
        text: `Permissions → ${yolo ? 'run all' : 'ask'}`,
      });
    }
    modal = null;
    markDirty();
  };

  const handleModalKey = (key: string) => {
    if (!modal) return;
    if (modal.kind === 'confirm') {
      if (key === 'y' || key === 'enter') settleConfirm(true);
      else if (key === 'n' || key === 'escape') settleConfirm(false);
      return;
    }
    if (key === 'escape') {
      modal = null;
      markDirty();
      return;
    }
    if (modal.kind === 'settings') {
      if (key === '1' || key === 'm') openModel();
      else if (key === '2') openMode();
      else if (key === '3') openPerm();
      else if (key === 'enter') openModel();
      return;
    }
    if (
      modal.kind === 'model' ||
      modal.kind === 'mode' ||
      modal.kind === 'perm'
    ) {
      const items =
        modal.kind === 'model'
          ? stackModels.map((p) => p.id)
          : modal.kind === 'mode'
            ? ['agent', 'ask']
            : ['ask', 'run-all'];
      if (!items.length) return;
      if (key === 'up') {
        modal.idx = (modal.idx - 1 + items.length) % items.length;
        markDirty();
      } else if (key === 'down') {
        modal.idx = (modal.idx + 1) % items.length;
        markDirty();
      } else if (key === 'enter') {
        applyModalPick(items[modal.idx]!);
      }
    }
  };

  // --- boot ---
  enterAltScreen();
  const onData = createInputParser((ev) => {
    void onKey(ev);
  });
  process.stdin.on('data', onData);
  const onResize = () => {
    markDirty();
  };
  process.stdout.on('resize', onResize);

  try {
    while (!shouldExit) {
      if (dirty) {
        dirty = false;
        render();
      }
      await new Promise((r) => setTimeout(r, 16));
    }
  } finally {
    persistEval();
    process.stdin.off('data', onData);
    process.stdout.off('resize', onResize);
    leaveAltScreen();
  }
}

function formatToolPreview(
  name: string,
  args: Record<string, unknown>,
): string {
  if (
    (name === 'shell' || name === 'bash') &&
    typeof args.command === 'string'
  ) {
    return `shell: ${args.command.slice(0, 160)}`;
  }
  if (typeof args.path === 'string') {
    return `${name}: ${args.path}`;
  }
  const raw = JSON.stringify(args);
  return `${name}: ${raw.slice(0, 120)}`;
}

function drawModal(
  frame: Frame,
  cols: number,
  rows: number,
  modal: Exclude<Modal, null>,
  model: string,
  mode: AgentMode,
  yolo: boolean,
  stackModels: ModelPreset[] = [],
): void {
  const w = Math.min(56, cols - 4);
  const modelCount = Math.max(1, stackModels.length);
  const h =
    modal.kind === 'settings'
      ? 12
      : modal.kind === 'confirm'
        ? 11
        : modal.kind === 'model'
          ? Math.min(Math.max(10, Math.min(rows - 4, modelCount + 6)), rows - 2)
          : 10;
  const x = Math.floor((cols - w) / 2);
  const y = Math.floor((rows - h) / 2);

  // dim backdrop hint
  frame.box(x, y, w, h, {
    title:
      modal.kind === 'settings'
        ? 'settings'
        : modal.kind === 'model'
          ? 'model'
          : modal.kind === 'mode'
            ? 'mode'
            : 'permissions',
    focus: true,
  });

  if (modal.kind === 'settings') {
    const lines = [
      { id: 'modal:goto:model', t: `1  Model        ${modelLabel(model)}` },
      {
        id: 'modal:goto:mode',
        t: `2  Mode         ${mode === 'ask' ? 'ask mode' : 'agent mode'}`,
      },
      {
        id: 'modal:goto:perm',
        t: `3  Permissions  ${yolo && mode === 'agent' ? 'run all' : 'ask'}`,
      },
    ];
    for (let i = 0; i < lines.length; i++) {
      const yy = y + 2 + i * 2;
      frame.text(x + 2, yy, ansi.cyan(lines[i]!.t));
      frame.hit(lines[i]!.id, x + 2, yy, w - 4, 1);
    }
    frame.text(x + 2, y + h - 2, ansi.dim('click · 1/2/3 · esc close'));
    frame.hit('modal:close', x + w - 6, y, 4, 1);
    return;
  }

  if (modal.kind === 'confirm') {
    frame.text(x + 2, y + 2, ansi.bold(truncate(modal.title, w - 4)), w - 4);
    const bodyLines = modal.body.split('\n');
    for (let i = 0; i < Math.min(3, bodyLines.length); i++) {
      frame.text(
        x + 2,
        y + 4 + i,
        ansi.dim(truncate(bodyLines[i]!, w - 4)),
        w - 4,
      );
    }
    frame.text(x + 3, y + h - 3, ansi.green('[ y ] allow'), 12);
    frame.hit('modal:yes', x + 3, y + h - 3, 12, 1);
    frame.text(x + 18, y + h - 3, ansi.red('[ n ] deny'), 12);
    frame.hit('modal:no', x + 18, y + h - 3, 12, 1);
    frame.text(x + 2, y + h - 2, ansi.dim('y / n / esc'), w - 4);
    return;
  }

  const items =
    modal.kind === 'model'
      ? stackModels.map((p) => ({
          value: p.id,
          label: `${modelLabel(p.id).padEnd(8)} ${p.blurb}`,
        }))
      : modal.kind === 'mode'
        ? [
            { value: 'agent', label: 'agent mode — edit & run tools' },
            { value: 'ask', label: 'ask mode — read-only' },
          ]
        : [
            { value: 'ask', label: 'ask — confirm before tools' },
            { value: 'run-all', label: 'run all — skip confirms (yolo)' },
          ];

  const idx = modal.idx;
  const maxRows = Math.max(1, h - 4);
  const start = Math.max(0, Math.min(idx - Math.floor(maxRows / 2), items.length - maxRows));
  for (let row = 0; row < maxRows && start + row < items.length; row++) {
    const i = start + row;
    const it = items[i]!;
    const yy = y + 2 + row;
    const mark = i === idx ? ansi.accent('❯ ') : '  ';
    const lab =
      i === idx ? ansi.bold(truncate(it.label, w - 6)) : truncate(it.label, w - 6);
    frame.text(x + 2, yy, mark + lab);
    frame.hit(`modal:pick:${it.value}`, x + 2, yy, w - 4, 1);
  }
  frame.text(x + 2, y + h - 2, ansi.dim('↑↓ · enter · esc'));
}
