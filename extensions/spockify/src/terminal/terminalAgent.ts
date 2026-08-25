/**
 * Terminal Agent — AgentRuntime + terminal_run.
 * Plan UI → multi-session → policy still ask-default.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { buildAtContext } from '../rules';
import { looksLikeShellCommand } from './isShellCommand';
import { loadTerminalAgentSettings, tierSummaryForPrompt } from './policy';
import { sandboxHintMarkdown } from './policy/sandbox';
import { resolveBwrapPath } from './policy/osSandbox';
import { workspaceTerminalCwd } from './runTerminalTool';
import {
  formatPlanForPrompt,
  parseNumberedPlan,
  showPlanApproval,
  type PlanStep,
} from './session/plan';
import {
  patchActiveSession,
  removeActiveSession,
  upsertActiveSession,
} from './session/active';
import { registerTerminalSessionsView } from './session/sessionsView';
import {
  getRuntimeHandle,
  shouldAutoApproveShell,
  stripToolFences,
  type AgentMessage,
} from '../runtime';
import { textFromContent } from '../chat/chatContent';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

export interface ProposedCommand {
  command: string;
  rationale?: string;
}

/** Extract ```bash / ```sh blocks or "RUN: …" lines (legacy / fallback). */
export function parseProposedCommands(text: string): ProposedCommand[] {
  const out: ProposedCommand[] = [];
  const fence = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const body = m[1].trim();
    if (!body || !looksLikeShellCommand(body)) continue;
    out.push({ command: body });
  }
  for (const line of text.split('\n')) {
    const run = line.match(/^\s*(?:RUN|Command)\s*:\s*(.+)$/i);
    if (run) {
      const cmd = run[1].trim();
      if (cmd && looksLikeShellCommand(cmd)) {
        out.push({ command: cmd });
      }
    }
  }
  return out;
}

async function openSessionTranscript(
  goal: string,
  sections: string[],
): Promise<void> {
  const settings = loadTerminalAgentSettings();
  if (!settings.openTranscript) return;
  const content = [`# Terminal Agent session`, '', `**Goal:** ${goal}`, '', ...sections].join('\n');
  const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true });
}

function baseSystem(
  cwd: string,
  settings: ReturnType<typeof loadTerminalAgentSettings>,
  planLock?: string,
): string {
  const lines = [
    'You are Spockify Terminal Agent in VS Code — long-horizon shell autonomy (Claude Code–class loop).',
    `Workspace cwd: ${cwd}`,
    `Policy mode: ${settings.policy} (dangerous commands are always blocked).`,
    tierSummaryForPrompt(settings),
    sandboxHintMarkdown(settings).replace(/\*\*/g, ''),
    'Long-horizon workflow:',
    '1) Prefer a short numbered plan when the goal needs >1 step.',
    '2) Execute with terminal_run one command at a time; read the result before the next.',
    '3) Prefer allowlisted commands so the loop can auto-continue without interrupting the user.',
    '4) Adapt the plan if a step fails; do not blindly retry destructive actions.',
    '5) Keep going across many turns until the goal is done or blocked — use the full maxTurns budget.',
    '6) When done, summarize what ran and the final outcome — no further tool calls.',
    'Use the terminal_run tool for each shell command (native tool_calls or ```tool JSON fences).',
    'terminal_run.command MUST be a real shell argv / one-liner or short script — never markdown headings, plans, docs, or multi-paragraph prose.',
    `Default terminal_run timeout is ~60s; for long builds/tests pass "timeoutMs": ${Math.max(settings.timeoutMs, 300_000)} in arguments.`,
    'Prefer safe, non-destructive commands. Do NOT propose rm -rf, mkfs, dd, or curl|bash.',
  ];
  if (planLock) {
    lines.push(
      '',
      'Approved plan (follow unless a step fails — then adapt and explain):',
      planLock,
    );
  }
  return lines.join('\n');
}

async function runPlanningTurn(
  transport: ModelTransport,
  model: string,
  goal: string,
  ctx: string,
  cwd: string,
  settings: ReturnType<typeof loadTerminalAgentSettings>,
  sessionId: string,
  abort: AbortSignal,
): Promise<{ planText: string; steps: PlanStep[] }> {
  const runtimeHandle = getRuntimeHandle();
  if (!runtimeHandle) {
    return { planText: '', steps: [] };
  }
  const runtime = runtimeHandle.createRuntime(transport);
  const planSystem = [
    baseSystem(cwd, settings),
    'PLANNING ONLY: Reply with a short numbered plan (3–8 steps). Do NOT call any tools.',
  ].join('\n');
  let streamed = '';
  await runtime.run({
    model,
    mode: 'ask',
    systemPrompt: planSystem,
    messages: [
      {
        role: 'user',
        content: `Plan (no tools) for:\n${goal}\n\nContext:\n${ctx || '(none)'}`,
      },
    ],
    maxTurns: 1,
    sessionId: `${sessionId}_plan`,
    signal: abort,
    onEvent: (ev) => {
      if (ev.type === 'text') streamed += ev.content;
    },
  });
  const planText = stripToolFences(streamed).trim();
  return { planText, steps: parseNumberedPlan(planText) };
}

export function registerTerminalAgent(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): void {
  const sessionsView = registerTerminalSessionsView(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'spockify.terminalAgent.rewind',
      async (arg?: string | { sessionId?: string }) => {
        const { rewindTerminalSession } = await import('./session/store');
        const id =
          typeof arg === 'string'
            ? arg
            : arg && typeof arg === 'object' && 'sessionId' in arg
              ? arg.sessionId
              : undefined;
        await rewindTerminalSession(context, id);
        sessionsView.refresh();
      },
    ),
    vscode.commands.registerCommand('spockify.terminalAgent.auditLog', async () => {
      const { readAuditLog } = await import('./policy/audit');
      const entries = await readAuditLog(80);
      if (!entries.length) {
        void vscode.window.showInformationMessage(
          'No terminal audit entries yet (.spockify/terminal-audit.jsonl).',
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        content: [
          '# Spockify terminal audit',
          '',
          ...entries.map(
            (e) =>
              `- **${e.at}** \`${e.action}\` \`${e.command.slice(0, 120)}\`${e.reason ? ` — ${e.reason}` : ''}`,
          ),
        ].join('\n'),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('spockify.terminalAgent.policyStatus', async () => {
      const settings = loadTerminalAgentSettings();
      const doc = await vscode.workspace.openTextDocument({
        content: [
          '# Terminal Agent policy',
          '',
          sandboxHintMarkdown(settings),
          '',
          `**Allowlist patterns:** ${settings.allowlist.length}`,
          '',
          '```',
          ...settings.allowlist.slice(0, 40),
          settings.allowlist.length > 40 ? '…' : '',
          '```',
          '',
          '_Default remains **ask**. Opt into `allowlist` for Claude Code–class auto-continue._',
        ]
          .filter(Boolean)
          .join('\n'),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('spockify.terminalAgent.checkSandbox', async () => {
      const settings = loadTerminalAgentSettings();
      const { isBundledBwrap } = await import('./policy/osSandbox');
      const bwrap = resolveBwrapPath();
      const bundled = isBundledBwrap(bwrap);
      const remote = Boolean(vscode.env.remoteName);
      const source = !bwrap
        ? '_not found_'
        : bundled
          ? `AppImage-bundled (\`${bwrap}\`)`
          : `host (\`${bwrap}\`)`;
      const lines = [
        `# OS sandbox check`,
        '',
        `**Mode:** \`${settings.osSandbox}\``,
        `**Fail-closed:** ${settings.osSandboxFailClosed}`,
        `**bwrap:** ${source}${!bwrap ? ' — install `bubblewrap` on the host, or use an AppImage that ships `resources/helpers/bwrap`' : ''}`,
        `**Remote SSH:** ${remote ? `yes (\`${vscode.env.remoteName}\`) — local bwrap skipped` : 'no'}`,
        '',
        remote
          ? '_For jail under SSH, install bubblewrap on the **remote** host (host-side jail still open)._'
          : settings.osSandbox === 'off'
            ? '_Set `spockify.terminalAgent.osSandbox` to **workspace** (preferred) or `network` to enable. Prefer host `bubblewrap`; AppImage may ship a helper when built with it._'
            : bwrap
              ? '_Captured `terminal_run` will wrap with bwrap. Integrated terminal sendText is not jailing._'
              : settings.osSandboxFailClosed
                ? '_Fail-closed: commands will be **denied** until bwrap is available._'
                : '_Soft fallback: commands run **unsandboxed** until bwrap is available (enable `osSandboxFailClosed` to deny)._',
      ];
      const doc = await vscode.workspace.openTextDocument({
        content: lines.join('\n'),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand(
      'spockify.terminalAgent.continue',
      async (
        arg?: string | { sessionId?: string; goal?: string },
      ) => {
        const { getTerminalSession, pickTerminalSession } = await import(
          './session/store'
        );
        let goal: string | undefined;
        const sid =
          typeof arg === 'string'
            ? arg.trim()
            : arg && typeof arg === 'object'
              ? arg.sessionId
              : undefined;
        if (typeof arg === 'object' && arg?.goal?.trim()) {
          goal = arg.goal.trim();
        } else if (sid) {
          goal = getTerminalSession(context, sid)?.goal;
        }
        if (!goal) {
          const snap = await pickTerminalSession(
            context,
            'Continue — pick a past Terminal Agent goal',
          );
          goal = snap?.goal;
        }
        if (!goal) return;
        await vscode.commands.executeCommand('spockify.terminalAgent', goal);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.terminalAgent',
      async (presetGoal?: string) => {
        const transport = await getTransport();
        if (!transport) {
          return;
        }

        const goal =
          typeof presetGoal === 'string' && presetGoal.trim()
            ? presetGoal.trim()
            : (
                await vscode.window.showInputBox({
                  title: 'Spockify Terminal Agent',
                  prompt: 'What should the agent do in the terminal?',
                  placeHolder: 'Run echo hello then print working directory…',
                  ignoreFocusOut: true,
                })
              )?.trim();
        if (!goal) {
          return;
        }

        const settings = loadTerminalAgentSettings();
        const model =
          vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ||
          'spockify-auto';
        const ctx = await buildAtContext({
          includeSelection: true,
          includeActiveFile: false,
          context,
        });
        const cwd = workspaceTerminalCwd() || '(none)';
        const runtimeHandle = getRuntimeHandle();

        if (!runtimeHandle) {
          void vscode.window.showErrorMessage(
            'Agent runtime not registered — Terminal Agent unavailable.',
          );
          return;
        }

        runtimeHandle.refreshMcpBridge();
        const managed = runtimeHandle.sessions.create('agent', 'terminal');
        const abort = managed.abort;

        upsertActiveSession({
          id: managed.id,
          goal,
          cwd,
          status: 'planning',
          startedAt: Date.now(),
          abort,
        });
        sessionsView.refresh();

        let planSteps: PlanStep[] = [];
        let planLock: string | undefined;

        try {
          if (settings.planApproval && !shouldAutoApproveShell()) {
            patchActiveSession(managed.id, { status: 'awaiting_plan' });
            const { planText, steps } = await runPlanningTurn(
              transport,
              model,
              goal,
              ctx,
              cwd,
              settings,
              managed.id,
              abort.signal,
            );
            if (abort.signal.aborted) {
              patchActiveSession(managed.id, { status: 'cancelled' });
              return;
            }
            if (steps.length) {
              const decision = await showPlanApproval(goal, steps, planText);
              if (decision.decision === 'cancel') {
                patchActiveSession(managed.id, { status: 'cancelled' });
                removeActiveSession(managed.id);
                void vscode.window.showInformationMessage('Terminal Agent cancelled.');
                return;
              }
              if (decision.decision === 'approve') {
                planSteps = decision.editedSteps ?? steps;
                planLock = formatPlanForPrompt(planSteps);
                patchActiveSession(managed.id, {
                  planSteps: planSteps.map((s) => s.text),
                });
              }
              // skip → no lock
            } else if (planText) {
              output.appendLine(
                'terminal-agent: plan turn produced text but no numbered steps — continuing.',
              );
            }
          }

          const system = baseSystem(cwd, settings, planLock);
          const transcriptSections: string[] = [];
          if (planLock) {
            transcriptSections.push(`## Plan\n\n${planLock}`);
          }

          const messages: AgentMessage[] = [
            {
              role: 'user',
              content: `${goal}\n\nContext:\n${ctx || '(no file context)'}`,
            },
          ];

          const runtime = runtimeHandle.createRuntime(transport);
          let streamed = '';
          patchActiveSession(managed.id, { status: 'running' });
          sessionsView.refresh();

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Spockify Terminal Agent (${managed.id.slice(0, 8)})…`,
              cancellable: true,
            },
            async (_p, token) => {
              token.onCancellationRequested(() => {
                managed.abort.abort();
              });
              const result = await runtime.run({
                model,
                mode: 'agent',
                systemPrompt: system,
                messages,
                maxTurns: settings.maxTurns,
                sessionId: managed.id,
                signal: managed.abort.signal,
                onEvent: (ev) => {
                  if (ev.type === 'text') {
                    streamed += ev.content;
                  }
                  if (ev.type === 'toolStart') {
                    output.appendLine(`terminal-agent tool: ${ev.name}`);
                    transcriptSections.push(
                      `### Tool ${ev.name}\n\n\`\`\`json\n${JSON.stringify(ev.arguments, null, 2)}\n\`\`\``,
                    );
                  }
                  if (ev.type === 'toolResult') {
                    output.appendLine(
                      `terminal-agent result: ok=${ev.ok} ${ev.error || ''}`,
                    );
                    transcriptSections.push(
                      `#### Result\n\n\`\`\`\n${(ev.content || ev.error || '').slice(0, 8000)}\n\`\`\``,
                    );
                  }
                },
              });
              runtimeHandle.sessions.setStatus(
                managed.id,
                result.cancelled ? 'cancelled' : 'done',
              );
              const last = [...result.messages]
                .reverse()
                .find((m) => m.role === 'assistant');
              const summary = stripToolFences(
                textFromContent(last?.content || streamed),
              );
              if (summary) {
                transcriptSections.unshift(`## Summary\n\n${summary}`);
              }
              output.appendLine(
                `--- terminal-agent runtime done cancelled=${result.cancelled} ---\n${summary}\n`,
              );

              const status = result.cancelled ? 'cancelled' : 'done';
              patchActiveSession(managed.id, { status });
              await openSessionTranscript(goal, transcriptSections);
              const { saveTerminalSession } = await import('./session/store');
              const commands = transcriptSections
                .map((sec) => {
                  const m = sec.match(
                    /### Tool terminal_run[\s\S]*?"command"\s*:\s*"([^"]+)"/,
                  );
                  return m?.[1];
                })
                .filter((c): c is string => !!c);
              saveTerminalSession(context, {
                id: managed.id,
                goal,
                cwd,
                sections: transcriptSections,
                createdAt: Date.now(),
                commands,
                planSteps: planSteps.map((s) => s.text),
                status,
              });
              sessionsView.refresh();
              void vscode.window.showInformationMessage(
                result.cancelled
                  ? 'Terminal Agent cancelled.'
                  : 'Terminal Agent finished.',
              );
            },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          patchActiveSession(managed.id, { status: 'error', lastError: msg });
          output.appendLine(`terminal-agent error: ${msg}`);
          void vscode.window.showErrorMessage(`Terminal Agent: ${msg}`);
        }
      },
    ),
  );
}
