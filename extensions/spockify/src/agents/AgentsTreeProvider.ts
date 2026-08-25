/**
 * Spockify Agents — multi-agent / room / parallel runs UI.
 * Live status cards, synthesis teasers, cancel clarity — Cursor multitask analogue.
 */

import * as vscode from 'vscode';
import type {
  AgentRun,
  ModelTransport,
  RemoteSpockifyProvider,
} from '@spockify/ide-client';
import {
  AGENT_POLL_MS,
  anyRunBusy,
  buildRunMarkdown,
  isRunBusy,
  pollIntervalForRuns,
  runCollapsibleState,
  runProgressDescription,
  runStatusIcon,
  runTooltipMarkdown,
  sanitizeAgentRun,
  sanitizeAgentRuns,
  synthesisHeadingLine,
  workerProgressDescription,
  workerStateIcon,
  workerTooltipMarkdown,
} from './agentRunUi';
import {
  agentRunToCardPayload,
  publishAgentRunToChat,
  setAgentRunTrackListener,
} from './agentRunChatBridge';
import { preferTerminalForPrompt } from '../runtime/tools/shellAgentIntent';
import {
  getLocalAgentRun,
  isLocalAgentRunId,
  listLocalAgentRuns,
} from './localAgentRunStore';
import { SpawnQueue } from './spawnQueue';

const VIEW_ID = 'spockify.agents';
/** Activity-bar container for Agents (not the same as `{viewId}.focus`). */
const AGENTS_CONTAINER_FOCUS = 'workbench.view.extension.spockify-agents';
export { VIEW_ID as AGENTS_VIEW_ID };

export type AgentsTransportFactory = () => Promise<
  ModelTransport | undefined
>;

export function asRemote(
  transport: ModelTransport,
): RemoteSpockifyProvider | undefined {
  const candidate = transport as RemoteSpockifyProvider;
  if (
    typeof candidate.listAgentRuns === 'function' &&
    typeof candidate.createAgentRun === 'function' &&
    typeof candidate.getAgentRun === 'function'
  ) {
    return candidate;
  }
  return undefined;
}

function truncLabel(text: string, max = 64): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

class AgentRunItem extends vscode.TreeItem {
  constructor(
    readonly run: AgentRun,
    opts?: { cancelling?: boolean },
  ) {
    const label = run.parent_prompt?.trim() || run.id;
    super(truncLabel(label), runCollapsibleState(run));
    this.id = run.id;
    const cancelling = !!opts?.cancelling;
    this.description = runProgressDescription(run, { cancelling });
    this.tooltip = runTooltipMarkdown(run, { cancelling });
    this.contextValue = cancelling
      ? 'spockify.agentRun.cancelling'
      : `spockify.agentRun.${run.status}`;
    this.iconPath = runStatusIcon(run, { cancelling });
    this.command = {
      command: 'spockify.agents.openRunPanel',
      title: 'Open run (live)',
      arguments: [run.id],
    };
  }
}

class WorkerItem extends vscode.TreeItem {
  constructor(runId: string, worker: NonNullable<AgentRun['workers']>[number]) {
    super(
      worker.name || worker.id,
      vscode.TreeItemCollapsibleState.None,
    );
    this.description = workerProgressDescription(worker);
    this.tooltip = workerTooltipMarkdown(worker);
    this.contextValue = `spockify.agentWorker.${worker.state || 'unknown'}`;
    this.iconPath = workerStateIcon(worker.state);
    this.id = `${runId}:${worker.id}`;
  }
}

class AgentsEmptyItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'spockify.agents.empty';
  }
}

export class AgentsTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private runs: AgentRun[] = [];
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pollMs = AGENT_POLL_MS;
  private lastReloadError: string | undefined;
  /** Optimistic stop — ids awaiting cancel acknowledgement. */
  private readonly cancellingIds = new Set<string>();
  private treeView: vscode.TreeView<vscode.TreeItem> | undefined;
  /** Serializes the actual create-run network call — see spawnQueue.ts. */
  private readonly spawnQueue = new SpawnQueue();
  /** Run ids Chat is showing as live cards — refresh pushes clone-safe snapshots. */
  private readonly chatTrackedIds = new Set<string>();
  /** Last published status per tracked run — used for completion toasts. */
  private readonly chatStatusSeen = new Map<string, string>();
  private openRunPanelFn:
    | ((runId: string) => void)
    | undefined;

  constructor(private readonly getTransport: AgentsTransportFactory) {}

  /** Bound from registerAgentsView so spawn can open the live panel by id. */
  setOpenRunPanel(fn: (runId: string) => void): void {
    this.openRunPanelFn = fn;
  }

  /**
   * Chat / tool create paths call this so live cards keep updating even when
   * the Agents tree was never opened (no poll yet).
   * Local (`local-*`) runs update via the in-memory store only — never poll
   * the remote `/agents/runs` API for them.
   */
  trackRunInChat(runId: string): void {
    if (!runId) return;
    if (isLocalAgentRunId(runId)) {
      const local = getLocalAgentRun(runId);
      if (local) {
        this.mergeLocalIntoRuns();
        this._onDidChangeTreeData.fire();
      }
      return;
    }
    this.chatTrackedIds.add(runId);
    void this.reloadRuns(true).then(() => {
      this.startPolling(pollIntervalForRuns(this.runs));
    });
  }

  /** Keep tree `runs` in sync with local store without a remote fetch. */
  private mergeLocalIntoRuns(): void {
    const locals = listLocalAgentRuns();
    const remoteOnly = this.runs.filter((r) => !isLocalAgentRunId(r.id));
    this.runs = [...locals, ...remoteOnly];
  }

  private publishRunToChat(run: AgentRun): void {
    const payload = agentRunToCardPayload(run);
    if (!payload) return;
    this.chatTrackedIds.add(run.id);
    this.chatStatusSeen.set(run.id, run.status);
    publishAgentRunToChat(payload);
  }

  private notifyRunFinished(run: AgentRun): void {
    const label =
      run.parent_prompt?.trim().slice(0, 48) || truncLabel(run.id, 16);
    const synth = run.synthesis?.trim();
    const teaser = synth
      ? synth.split(/\r?\n/).find((l) => l.trim())?.trim()?.slice(0, 80)
      : undefined;
    if (run.status === 'done') {
      void vscode.window.showInformationMessage(
        teaser
          ? `Agent run done — ${teaser}`
          : `Agent run done — ${label}`,
      );
    } else if (run.status === 'failed') {
      void vscode.window.showWarningMessage(
        `Agent run failed — ${run.error?.trim().slice(0, 80) || label}`,
      );
    } else if (run.status === 'cancelled') {
      void vscode.window.showInformationMessage(
        `Agent run stopped — ${label}`,
      );
    }
  }

  private publishTrackedRunsToChat(): void {
    if (!this.chatTrackedIds.size) return;
    for (const id of [...this.chatTrackedIds]) {
      const run = this.runs.find((r) => r.id === id);
      if (!run) {
        this.chatTrackedIds.delete(id);
        this.chatStatusSeen.delete(id);
        continue;
      }
      const prev = this.chatStatusSeen.get(id);
      publishAgentRunToChat(
        agentRunToCardPayload(run) ?? {
          runId: id,
          status: run.status,
        },
      );
      this.chatStatusSeen.set(id, run.status);
      if (
        prev &&
        isRunBusy(prev as AgentRun['status']) &&
        !isRunBusy(run.status)
      ) {
        this.notifyRunFinished(run);
      }
      if (!isRunBusy(run.status)) {
        this.chatTrackedIds.delete(id);
        this.chatStatusSeen.delete(id);
      }
    }
  }

  attachTreeView(tree: vscode.TreeView<vscode.TreeItem>): void {
    this.treeView = tree;
  }

  refresh(): void {
    void this.reloadRuns(true);
  }

  private updateTreeTitle(): void {
    if (!this.treeView) {
      return;
    }
    const busy = this.runs.filter((r) => isRunBusy(r.status)).length;
    const stopping = this.cancellingIds.size;
    if (stopping > 0) {
      this.treeView.description = `stopping ${stopping}…`;
    } else if (busy > 0) {
      this.treeView.description = `${busy} live`;
    } else {
      this.treeView.description = undefined;
    }
  }

  private syncPollingFromRuns(): void {
    const remoteRuns = this.runs.filter((r) => !isLocalAgentRunId(r.id));
    if (anyRunBusy(remoteRuns) || this.cancellingIds.size > 0) {
      const next = pollIntervalForRuns(remoteRuns);
      if (this.pollTimer && next !== this.pollMs) {
        this.stopPolling();
      }
      this.pollMs = next;
      this.startPolling(this.pollMs);
    } else {
      this.stopPolling();
    }
  }

  startPolling(ms = AGENT_POLL_MS): void {
    if (this.pollTimer) {
      return;
    }
    this.pollMs = ms;
    this.pollTimer = setInterval(() => {
      void this.reloadRuns(true);
    }, ms);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /** Fetch latest runs from API, update tree, adjust poll interval. */
  async reloadRuns(fireTreeChange = false): Promise<void> {
    const locals = listLocalAgentRuns();
    const transport = await this.getTransport();
    if (!transport) {
      this.runs = [...locals];
      this.lastReloadError = undefined;
      this.cancellingIds.clear();
      this.stopPolling();
      this.updateTreeTitle();
      if (fireTreeChange) {
        this._onDidChangeTreeData.fire();
      }
      return;
    }
    const remote = asRemote(transport);
    if (!remote) {
      this.runs = [...locals];
      this.lastReloadError = undefined;
      this.cancellingIds.clear();
      this.stopPolling();
      this.updateTreeTitle();
      if (fireTreeChange) {
        this._onDidChangeTreeData.fire();
      }
      return;
    }
    try {
      const remoteRuns = sanitizeAgentRuns(await remote.listAgentRuns()).filter(
        (r) => !isLocalAgentRunId(r.id),
      );
      this.runs = [...locals, ...remoteRuns];
      this.lastReloadError = undefined;
      for (const id of [...this.cancellingIds]) {
        const run = this.runs.find((r) => r.id === id);
        if (!run || !isRunBusy(run.status)) {
          this.cancellingIds.delete(id);
        }
      }
      this.syncPollingFromRuns();
    } catch (err) {
      this.lastReloadError =
        err instanceof Error ? err.message : String(err);
      this.stopPolling();
      // Keep local runs visible even if remote list fails.
      this.mergeLocalIntoRuns();
    }
    this.updateTreeTitle();
    this.publishTrackedRunsToChat();
    if (fireTreeChange) {
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof AgentRunItem) {
      const workers = element.run.workers || [];
      return workers.map((w) => new WorkerItem(element.run.id, w));
    }
    if (element) {
      return [];
    }

    const transport = await this.getTransport();
    if (!transport) {
      return [
        new AgentsEmptyItem(
          'Sign in to Spockify to load agent runs (spockify.eu)',
        ),
      ];
    }
    const remote = asRemote(transport);
    if (!remote) {
      return [
        new AgentsEmptyItem(
          'Agents require Spockify cloud provider (remote)',
        ),
      ];
    }

    try {
      this.runs = sanitizeAgentRuns(await remote.listAgentRuns());
      this.lastReloadError = undefined;
      for (const id of [...this.cancellingIds]) {
        const run = this.runs.find((r) => r.id === id);
        if (!run || !isRunBusy(run.status)) {
          this.cancellingIds.delete(id);
        }
      }
      this.syncPollingFromRuns();
      this.updateTreeTitle();
      this.publishTrackedRunsToChat();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastReloadError = msg;
      this.stopPolling();
      this.updateTreeTitle();
      const authHint =
        /401|403|unauthorized|forbidden|sign.?in|auth/i.test(msg)
          ? ' — try Spockify: Sign In'
          : '';
      return [new AgentsEmptyItem(`Failed: ${msg}${authHint}`)];
    }

    if (this.lastReloadError && !this.runs.length) {
      const authHint =
        /401|403|unauthorized|forbidden|sign.?in|auth/i.test(
          this.lastReloadError,
        )
          ? ' — try Spockify: Sign In'
          : '';
      return [
        new AgentsEmptyItem(
          `Failed: ${this.lastReloadError}${authHint}`,
        ),
      ];
    }

    if (!this.runs.length) {
      this.stopPolling();
      this.updateTreeTitle();
      return [
        new AgentsEmptyItem(
          'No runs — New Agent Run / Room / Parallel',
        ),
      ];
    }
    return this.runs.map(
      (r) =>
        new AgentRunItem(r, { cancelling: this.cancellingIds.has(r.id) }),
    );
  }

  async spawnFromPrompt(
    output: vscode.OutputChannel,
    promptArg?: string,
    mode: 'parallel' | 'room' | 'custom' = 'parallel',
  ): Promise<AgentRun | undefined> {
    const transport = await this.getTransport();
    const remote = transport ? asRemote(transport) : undefined;
    if (!remote) {
      void vscode.window.showWarningMessage(
        'Spockify Agents: sign in and use remote provider.',
      );
      return undefined;
    }

    let prompt = promptArg?.trim();
    if (!prompt) {
      prompt = await vscode.window.showInputBox({
        title: 'Spockify Agent Run',
        prompt: 'Parent prompt for workers (via spockify.eu)',
        ignoreFocusOut: true,
        placeHolder: 'Research, implement, and critique an approach…',
      });
    }
    if (!prompt?.trim()) {
      return undefined;
    }

    // Shell/network probes must run locally — remote Explorer/Analyst workers
    // cannot ping and previously sat idle until the chat SSE idle-cancelled them.
    if (preferTerminalForPrompt(prompt)) {
      const { runLocalShellAgentRun } = await import(
        '../runtime/tools/builtins'
      );
      const result = await runLocalShellAgentRun(
        prompt.trim(),
        {
          sessionId: `agents-local-${Date.now().toString(36)}`,
          mode: 'agent',
        },
        {
          getApplyService: () => {
            throw new Error('apply not used for local shell agents');
          },
          output,
          getTransport: this.getTransport,
        },
      );
      output.appendLine(
        `agents: spawnFromPrompt local_shell ok=${result.ok} ${result.error || result.content.slice(0, 120)}`,
      );
      if (!result.ok) {
        void vscode.window.showErrorMessage(
          `Local shell agents failed: ${result.error || 'unknown'}`,
        );
      }
      return undefined;
    }

    const defaultModel =
      mode === 'room'
        ? 'spockify-room'
        : mode === 'parallel'
          ? 'spockify-agents'
          : vscode.workspace
              .getConfiguration('spockify')
              .get<string>('defaultModel') || 'spockify-auto';

    // The actual run creation is the only step that can legitimately fail
    // the whole operation. Everything after it (toast, tree refresh, poll,
    // focus) is best-effort UI polish: previously all of it shared one
    // try/catch, so any hiccup in e.g. the tree refresh (a cross-process
    // extension-host <-> renderer hop, which throws "An object could not
    // be cloned" if a non-plain value ever rides along) got reported as
    // "spawnFromPrompt failed" and *discarded the run the router had
    // already created* (id + status=pending, as logged) — leaving a live,
    // billed run the UI told the user never started. Sanitizing the run
    // (see sanitizeAgentRun) closes the likely clone vector; splitting the
    // try/catch closes the misreporting regardless of the exact cause.
    let run: AgentRun;
    try {
      // Serialize the actual create call through a small FIFO: if another
      // spawn triggered from the same UI (e.g. "Spawn Agents" double-clicked,
      // or fired again before the first create settles) is still in
      // flight, this one queues behind it — visible via toast — instead of
      // firing a second concurrent create or silently dropping the
      // request.
      run = await this.spawnQueue.run(
        async () => {
          const raw = await remote.createAgentRun({
            parent_prompt: prompt.trim(),
            model: defaultModel,
            synthesize: true,
          });
          return sanitizeAgentRun(raw);
        },
        (ahead) => {
          void vscode.window.showInformationMessage(
            `Spockify Agents: queued (${ahead} ahead) — starting once earlier spawn(s) finish…`,
          );
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      output.appendLine(
        `agents: spawnFromPrompt failed (create): ${msg}${stack ? `\n${stack}` : ''}`,
      );
      void vscode.window.showErrorMessage(`Agent run failed: ${msg}`);
      return undefined;
    }

    output.appendLine(
      `agents: spawnFromPrompt ${run.id} status=${run.status} model=${defaultModel}`,
    );

    // Chat card + panel open use only plain strings / sanitized payloads —
    // never pass TreeItems or raw API objects through commands/postMessage.
    this.publishRunToChat(run);

    try {
      void vscode.window.showInformationMessage(
        `Agent run started — live in Agents panel (${truncLabel(run.id, 24)})`,
      );
    } catch (err) {
      output.appendLine(
        `agents: spawnFromPrompt post-create toast failed (run ${run.id} still started): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.reloadRuns(true);
      this.startPolling(pollIntervalForRuns(this.runs));
    } catch (err) {
      output.appendLine(
        `agents: spawnFromPrompt post-create refresh failed (run ${run.id} still started): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      // Do NOT call `spockify.agents.focus` here — that command id is also
      // registered by us and used to mean "focus the Agents container". Calling
      // `${VIEW_ID}.focus` (same string) re-entered our handler and blew up
      // with "An object could not be cloned" on the command marshal path.
      await vscode.commands.executeCommand(AGENTS_CONTAINER_FOCUS);
      this.openRunPanelFn?.(run.id);
    } catch (err) {
      output.appendLine(
        `agents: spawnFromPrompt post-create focus failed (run ${run.id} still started): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return run;
  }

  async createRun(
    output: vscode.OutputChannel,
    mode: 'parallel' | 'room' | 'custom' = 'parallel',
  ): Promise<void> {
    await this.spawnFromPrompt(output, undefined, mode);
  }

  async cancelRun(
    item: vscode.TreeItem | undefined,
    output: vscode.OutputChannel,
  ): Promise<void> {
    let runId: string | undefined;
    let label: string | undefined;
    let status: string | undefined;
    if (item instanceof AgentRunItem) {
      runId = item.run.id;
      label = item.run.parent_prompt?.trim() || runId;
      status = item.run.status;
      if (this.cancellingIds.has(runId)) {
        void vscode.window.showInformationMessage(
          'Stop already requested for this run — waiting…',
        );
        return;
      }
      if (!isRunBusy(item.run.status)) {
        void vscode.window.showInformationMessage(
          `Run is already ${item.run.status} — nothing to stop.`,
        );
        return;
      }
    } else {
      runId = await vscode.window.showInputBox({
        title: 'Stop agent run',
        prompt: 'Run id to stop (cancels workers via spockify.eu)',
      });
    }
    if (!runId?.trim()) {
      return;
    }
    await this.cancelRunById(runId.trim(), output, {
      label,
      status,
      confirm: true,
    });
  }

  /**
   * Cancel a remote agent run by id. Used by the Agents tree (with confirm)
   * and the chat Agents HUD (quiet — no modal).
   */
  async cancelRunById(
    runId: string,
    output: vscode.OutputChannel,
    opts?: { label?: string; status?: string; confirm?: boolean },
  ): Promise<void> {
    const trimmedId = runId.trim();
    if (!trimmedId) return;
    if (this.cancellingIds.has(trimmedId)) {
      void vscode.window.showInformationMessage(
        'Stop already requested for this run — waiting…',
      );
      return;
    }
    const known = this.runs.find((r) => r.id === trimmedId);
    const status = opts?.status ?? known?.status;
    if (known && !isRunBusy(known.status)) {
      void vscode.window.showInformationMessage(
        `Run is already ${known.status} — nothing to stop.`,
      );
      return;
    }
    if (isLocalAgentRunId(trimmedId)) {
      void vscode.window.showInformationMessage(
        'Local shell agent runs finish when their terminal commands complete — they cannot be stopped via the remote API.',
      );
      return;
    }
    const label =
      opts?.label ?? known?.parent_prompt?.trim() ?? trimmedId;
    if (opts?.confirm !== false) {
      const confirmLabel =
        label && label.length > 80 ? `${label.slice(0, 77)}…` : label;
      const detail = [
        confirmLabel ? `"${confirmLabel}"` : undefined,
        status ? `status: ${status}` : undefined,
        `id: ${trimmedId}`,
      ]
        .filter(Boolean)
        .join('\n');
      const picked = await vscode.window.showWarningMessage(
        `Stop this agent run?\n\n${detail}\n\nWorkers will be cancelled via spockify.eu. This cannot undo finished work.`,
        { modal: true },
        'Stop run',
      );
      if (picked !== 'Stop run') {
        return;
      }
    }

    const transport = await this.getTransport();
    const remote = transport ? asRemote(transport) : undefined;
    if (!remote) {
      void vscode.window.showWarningMessage(
        'Spockify Agents: sign in and use remote provider.',
      );
      return;
    }

    this.cancellingIds.add(trimmedId);
    this._onDidChangeTreeData.fire();
    this.updateTreeTitle();
    this.startPolling(AGENT_POLL_MS);

    try {
      await remote.cancelAgentRun(trimmedId);
      output.appendLine(`agents: stop requested ${trimmedId}`);
      void vscode.window.showInformationMessage(
        `Stopping agent run (${truncLabel(trimmedId, 24)})…`,
      );
      await this.reloadRuns(true);
    } catch (err) {
      this.cancellingIds.delete(trimmedId);
      this._onDidChangeTreeData.fire();
      this.updateTreeTitle();
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Stop failed: ${msg}`);
    }
  }

  async cancelAllBusy(output: vscode.OutputChannel): Promise<void> {
    const busy = this.runs.filter(
      (r) =>
        isRunBusy(r.status) &&
        !this.cancellingIds.has(r.id) &&
        !isLocalAgentRunId(r.id),
    );
    if (!busy.length) {
      void vscode.window.showInformationMessage('No live agent runs to stop.');
      return;
    }
    const picked = await vscode.window.showWarningMessage(
      `Stop all ${busy.length} live agent run(s)?\n\nEach run’s workers will be cancelled via spockify.eu.`,
      { modal: true },
      'Stop all',
    );
    if (picked !== 'Stop all') {
      return;
    }
    const transport = await this.getTransport();
    const remote = transport ? asRemote(transport) : undefined;
    if (!remote) {
      void vscode.window.showWarningMessage(
        'Spockify Agents: sign in and use remote provider.',
      );
      return;
    }
    for (const r of busy) {
      this.cancellingIds.add(r.id);
    }
    this._onDidChangeTreeData.fire();
    this.updateTreeTitle();
    this.startPolling(AGENT_POLL_MS);

    let ok = 0;
    let fail = 0;
    for (const r of busy) {
      try {
        await remote.cancelAgentRun(r.id);
        ok++;
        output.appendLine(`agents: stop requested ${r.id}`);
      } catch (err) {
        fail++;
        this.cancellingIds.delete(r.id);
        output.appendLine(
          `agents: stop failed ${r.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.reloadRuns(true);
    void vscode.window.showInformationMessage(
      fail
        ? `Stopped ${ok} run(s); ${fail} failed (see Output → Spockify).`
        : `Stopping ${ok} agent run(s)…`,
    );
  }

  async openRun(
    runId: string,
    output: vscode.OutputChannel,
  ): Promise<void> {
    try {
      let run: AgentRun | undefined;
      if (isLocalAgentRunId(runId)) {
        run = getLocalAgentRun(runId);
        if (!run) {
          void vscode.window.showWarningMessage(
            'Local agent run not found (may have expired).',
          );
          return;
        }
      } else {
        const transport = await this.getTransport();
        const remote = transport ? asRemote(transport) : undefined;
        if (!remote) {
          return;
        }
        run = await remote.getAgentRun(runId);
      }
      const md = buildRunMarkdown(run);
      const doc = await vscode.workspace.openTextDocument({
        content: md,
        language: 'markdown',
      });
      const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      });
      const synthLine = synthesisHeadingLine(md);
      if (synthLine !== undefined && run.synthesis?.trim()) {
        const pos = new vscode.Position(synthLine, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter,
        );
      } else if (run.status === 'synthesizing') {
        void vscode.window.showInformationMessage(
          'Synthesis still running — refresh by opening the run again.',
        );
      }
      output.appendLine(
        `agents: opened ${runId} (${isLocalAgentRunId(runId) ? 'local' : 'markdown'})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Open run failed: ${msg}`);
    }
  }
}

export function registerAgentsView(
  context: vscode.ExtensionContext,
  getTransport: AgentsTransportFactory,
  output: vscode.OutputChannel,
): AgentsTreeProvider {
  const provider = new AgentsTreeProvider(getTransport);
  const tree = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  provider.attachTreeView(tree);
  provider.setOpenRunPanel((runId: string) => {
    void import('./AgentsPanelProvider').then(({ openAgentRunPanel }) => {
      openAgentRunPanel(context, getTransport, output, runId);
    });
  });

  setAgentRunTrackListener((runId: string) => provider.trackRunInChat(runId));
  context.subscriptions.push({
    dispose: () => setAgentRunTrackListener(undefined),
  });

  context.subscriptions.push(
    tree,
    {
      dispose: () => provider.stopPolling(),
    },
    vscode.commands.registerCommand('spockify.agents.refresh', () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand('spockify.agents.newRun', async () => {
      await provider.createRun(output, 'parallel');
    }),
    vscode.commands.registerCommand('spockify.agents.newRoom', async () => {
      await provider.createRun(output, 'room');
    }),
    vscode.commands.registerCommand(
      'spockify.agents.spawnFromPrompt',
      async (prompt?: string) => {
        await provider.spawnFromPrompt(output, prompt, 'parallel');
      },
    ),
    vscode.commands.registerCommand(
      'spockify.agents.copyRunId',
      async (item?: vscode.TreeItem) => {
        const runId =
          item instanceof AgentRunItem
            ? item.run.id
            : typeof item === 'string'
              ? item
              : undefined;
        if (!runId) {
          void vscode.window.showWarningMessage('No agent run selected.');
          return;
        }
        await vscode.env.clipboard.writeText(runId);
        void vscode.window.showInformationMessage(`Copied run id: ${runId}`);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.agents.cancel',
      async (item?: vscode.TreeItem | string) => {
        if (typeof item === 'string') {
          await provider.cancelRunById(item, output, { confirm: false });
          return;
        }
        await provider.cancelRun(item, output);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.agents.cancelById',
      async (runId?: string) => {
        if (!runId?.trim()) return;
        await provider.cancelRunById(runId.trim(), output, { confirm: false });
      },
    ),
    vscode.commands.registerCommand(
      'spockify.agents.cancelAll',
      async () => {
        await provider.cancelAllBusy(output);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.agents.openRun',
      async (arg?: string | vscode.TreeItem) => {
        const runId =
          typeof arg === 'string'
            ? arg
            : arg instanceof AgentRunItem
              ? arg.run.id
              : undefined;
        if (runId) {
          await provider.openRun(runId, output);
        }
      },
    ),
    vscode.commands.registerCommand(
      'spockify.agents.openRunPanel',
      async (arg?: string | vscode.TreeItem) => {
        const runId =
          typeof arg === 'string'
            ? arg
            : arg instanceof AgentRunItem
              ? arg.run.id
              : undefined;
        if (!runId) return;
        const { openAgentRunPanel } = await import('./AgentsPanelProvider');
        openAgentRunPanel(context, getTransport, output, runId);
      },
    ),
    vscode.commands.registerCommand('spockify.agents.focus', async () => {
      // Open the Agents activity container. Never re-invoke this same command
      // id (that caused "An object could not be cloned" / recursive focus).
      await vscode.commands.executeCommand(AGENTS_CONTAINER_FOCUS);
    }),
    vscode.commands.registerCommand('spockify.agents.history', async () => {
      const transport = await getTransport();
      const remote = transport ? asRemote(transport) : undefined;
      if (!remote?.listAgentRuns) {
        void vscode.window.showWarningMessage('Sign in to view agent history.');
        return;
      }
      try {
        const runs = sanitizeAgentRuns(await remote.listAgentRuns());
        if (!runs.length) {
          void vscode.window.showInformationMessage('No agent runs yet.');
          return;
        }
        const pick = await vscode.window.showQuickPick(
          runs.map((r) => {
            const when = r.updated_at || r.created_at || '';
            const synth = r.synthesis?.trim()
              ? truncLabel(r.synthesis, 60)
              : undefined;
            return {
              label: `$(play) ${r.parent_prompt?.slice(0, 72) || r.id}`,
              description: r.status,
              detail: [r.id, when ? new Date(when).toLocaleString() : '', synth]
                .filter(Boolean)
                .join(' · '),
              // Plain string only — attaching the full run object made QuickPick
              // throw "An object could not be cloned" when API payloads grew.
              runId: r.id,
            };
          }),
          {
            title: 'Spockify agent run history — open / resume',
            matchOnDescription: true,
            matchOnDetail: true,
          },
        );
        if (pick?.runId) {
          const { openAgentRunPanel } = await import('./AgentsPanelProvider');
          openAgentRunPanel(context, getTransport, output, pick.runId);
        }
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Agent history failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  void provider.reloadRuns(true);
  return provider;
}
