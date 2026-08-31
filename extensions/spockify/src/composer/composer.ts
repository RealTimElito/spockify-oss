/**
 * Composer-ish multi-file edit — Phase 1 uses AgentRuntime (shared tool loop).
 * 0.5.1: panel/tree Accept default (Cursor-like); tool-aware revise history.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { buildAtContext, loadProjectRules } from '../rules';
import { parseMentions } from '../rules/mentions';
import { applyPatchesWithPreview } from './patchReview';
import {
  createComposerSession,
  historyForNextTurn,
  recordAgentTranscript,
  recordTurn,
} from './session';
import {
  openShadowForSession,
  stagePatchesInShadow,
  type ShadowWorkspaceHandle,
} from './shadowWorkspace';
import { collectComposerPatches } from './collectPatches';
import { textFromContent } from '../chat/chatContent';
import { thinkingRequestExtras } from '../chat/thinkingPrefs';
import {
  formatVerifyFailureContext,
  looksMultiFile,
  planningNudge,
} from './plan';
import { getComposerReviewMode, verifyAfterTurnEnabled } from './reviewMode';
import type { ComposerSession, FilePatch } from './types';
import {
  getRuntimeHandle,
  shouldAutoApplyFilePatches,
  stripToolFences,
  type AgentMessage,
} from '../runtime';
import { getApplyService } from '../apply';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

export type { FilePatch };
export { parseFilePatches, parseChatFencePatches, parseFenceInfo } from './parsePatches';
export { collectChatReviewPatches } from './materializeChatPatches';
export { applyPatchesWithPreview };

function composerSystemPrompt(rules: string): string {
  return [
    'You are Spockify Composer in an IDE.',
    'Workflow: (1) short numbered plan of files/steps (2) apply_patch or path-tagged fences (3) brief summary.',
    'Prefer the apply_patch tool with full file contents for each touched path.',
    'You may also output fenced blocks whose info string is the workspace-relative path, e.g.',
    '```src/foo.ts',
    '// full new file content',
    '```',
    'Full file contents, not diffs. Use codebase_search / grep / read_file when unsure where to edit.',
    'If verify/test output is provided, fix failures before proposing new unrelated edits.',
    rules ? `Project rules:\n${rules}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function shadowEnabled(): boolean {
  if (shouldAutoApplyFilePatches()) {
    return false;
  }
  return (
    vscode.workspace
      .getConfiguration('spockify')
      .get<boolean>('composer.shadowWorkspace') ?? true
  );
}

/** YOLO: write patches straight to the workspace (no Accept / Diff review). */
async function autoApplyPatches(
  patches: FilePatch[],
  output: vscode.OutputChannel,
): Promise<number> {
  const result = await getApplyService().apply(
    {
      files: patches.map((p) => ({ path: p.path, nextContent: p.content })),
      source: 'composer',
    },
    undefined,
  );
  output.appendLine(
    `composer: run-all-unsandboxed applied=${result.applied.join(',')} rejected=${result.rejected.join(',')}`,
  );
  if (result.applied.length) {
    void vscode.window.showInformationMessage(
      `Spockify applied ${result.applied.length} file(s) (unsandboxed)`,
    );
  }
  return result.applied.length;
}

async function attachComposerContext(
  instruction: string,
  extContext?: vscode.ExtensionContext,
): Promise<{ userContent: string; mentions: ReturnType<typeof parseMentions> }> {
  const mentions = parseMentions(instruction);
  let codebaseHits:
    | Array<{ path: string; startLine: number; endLine: number; text: string }>
    | undefined;

  const codebaseCfg = vscode.workspace.getConfiguration('spockify.codebase');
  const explicitCodebase =
    mentions.kinds.has('codebase') ||
    mentions.kinds.has('folder') ||
    /@codebase/i.test(instruction);
  const { shouldAttachCodebase } = await import('../codebase/attachPolicy');
  const wantCodebase = shouldAttachCodebase({
    explicit: explicitCodebase || looksMultiFile(instruction),
    autoAttach: codebaseCfg.get<boolean>('autoAttach', true),
    autoAttachAsk: true,
    uiMode: 'agent',
  });

  if (wantCodebase) {
    try {
      const { retrieveCodebaseHitsForQuery } = await import(
        '../codebase/retrieveForChat'
      );
      const retrieved = await retrieveCodebaseHitsForQuery(
        mentions.cleanQuery || instruction,
        { pathPrefix: mentions.folderPaths[0] },
      );
      codebaseHits = retrieved.hits;
    } catch {
      /* soft */
    }
  }

  const extraUris: vscode.Uri[] = [];
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root) {
    for (const rel of mentions.filePaths) {
      extraUris.push(vscode.Uri.joinPath(root, rel));
    }
  }

  const ctx = await buildAtContext({
    includeSelection: true,
    includeActiveFile: true,
    codebaseHits,
    extraUris,
    context: extContext,
  });

  let userContent = instruction.trim();
  if (looksMultiFile(instruction) || wantCodebase) {
    userContent = `${userContent}\n\n${planningNudge()}`;
  }
  if (ctx) {
    userContent = `${userContent}\n\nContext:\n${ctx}`;
  }
  return { userContent, mentions };
}

async function generateComposerTurn(
  transport: ModelTransport,
  session: ComposerSession,
  system: string,
  userContent: string,
  output: vscode.OutputChannel,
  opts?: { maxTurns?: number },
): Promise<{
  text: string;
  patches: FilePatch[];
  applyFailed: boolean;
  messages?: AgentMessage[];
}> {
  const model =
    vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ||
    'spockify-auto';

  const runtimeHandle = getRuntimeHandle();
  if (runtimeHandle) {
    runtimeHandle.refreshMcpBridge();
    const managed = runtimeHandle.sessions.create('agent', 'composer');
    const history: AgentMessage[] = historyForNextTurn(session);
    history.push({ role: 'user', content: userContent });

    const runtime = runtimeHandle.createRuntime(transport);
    let streamed = '';
    const toolApplyArgs: Array<Record<string, unknown>> = [];
    let applyFailed = false;
    const result = await runtime.run({
      model,
      mode: 'agent',
      systemPrompt: system,
      messages: history,
      maxTurns: opts?.maxTurns ?? 10,
      requestExtras: thinkingRequestExtras(),
      sessionId: managed.id,
      signal: managed.abort.signal,
      onEvent: (ev) => {
        if (ev.type === 'text') streamed += ev.content;
        if (ev.type === 'toolStart') {
          output.appendLine(`composer tool: ${ev.name}`);
          if (ev.name === 'apply_patch') {
            toolApplyArgs.push(ev.arguments);
          }
        }
        if (ev.type === 'toolResult') {
          output.appendLine(
            `composer tool result ${ev.name}: ok=${ev.ok} ckpt=${ev.checkpointId || '-'}`,
          );
          if (ev.name === 'apply_patch' && !ev.ok) {
            applyFailed = true;
          }
        }
        if (ev.type === 'status') {
          output.appendLine(`composer: ${ev.text}`);
        }
      },
    });
    runtimeHandle.sessions.setStatus(
      managed.id,
      result.cancelled ? 'cancelled' : 'done',
    );

    const lastAssistant = [...result.messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    const text = stripToolFences(
      textFromContent(lastAssistant?.content || streamed),
    );
    const patches = collectComposerPatches({
      assistantText: text,
      toolApplyArgs,
      messages: result.messages,
    });
    output.appendLine(
      `composer: runtime response ${text.length} chars tools=${result.messages.filter((m) => m.role === 'tool').length} patches=${patches.length} nativeOrFence history=${history.length}`,
    );
    return { text, patches, applyFailed, messages: result.messages };
  }

  // Fallback if runtime not registered
  const history = historyForNextTurn(session);
  const res = await transport.chatCompletions({
    model,
    messages: [
      { role: 'system', content: system },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ],
    stream: false,
    ...thinkingRequestExtras(),
  });
  const text = textFromContent(res.choices?.[0]?.message?.content ?? '');
  output.appendLine(
    `composer: turn ${session.turns.length / 2 + 1} response ${text.length} chars`,
  );
  return {
    text,
    patches: collectComposerPatches({ assistantText: text }),
    applyFailed: false,
    messages: [
      ...history,
      { role: 'user', content: userContent },
      { role: 'assistant', content: text },
    ],
  };
}

async function runComposerSession(
  transport: ModelTransport,
  output: vscode.OutputChannel,
  extContext?: vscode.ExtensionContext,
): Promise<void> {
  const session = createComposerSession();
  const rules = await loadProjectRules();
  const system = composerSystemPrompt(rules ?? '');
  let shadow: ShadowWorkspaceHandle | undefined;
  let pendingVerifyFix: string | undefined;

  for (let turn = 0; ; turn++) {
    const isFirst = turn === 0;
    let instruction: string | undefined;

    if (pendingVerifyFix) {
      instruction = pendingVerifyFix;
      pendingVerifyFix = undefined;
      void vscode.window.showInformationMessage(
        'Composer recovering from verify failure…',
      );
    } else {
      instruction = await vscode.window.showInputBox({
        title: isFirst
          ? 'Spockify Composer (multi-file)'
          : 'Spockify Composer — Revise',
        prompt: isFirst
          ? 'Describe the multi-file change (@codebase / @file path ok)'
          : 'Continue the session (previous files and turns are kept)',
        placeHolder: isFirst
          ? 'Add error handling across auth.ts and http.ts…'
          : 'Also update tests; rename foo to bar…',
        ignoreFocusOut: true,
      });
    }

    if (!instruction?.trim()) {
      if (isFirst) {
        return;
      }
      const done = await vscode.window.showInformationMessage(
        'End Composer session?',
        'Done',
        'Revise again',
      );
      if (done !== 'Revise again') {
        break;
      }
      continue;
    }

    let userContent: string;
    if (isFirst || instruction.startsWith('Previous Composer verify')) {
      const attached = await attachComposerContext(instruction, extContext);
      userContent = attached.userContent;
    } else if (session.fileTouchList.length) {
      userContent = `${instruction.trim()}\n\nFiles touched in this session: ${session.fileTouchList.join(', ')}\n\n${planningNudge()}`;
    } else {
      userContent = instruction.trim();
    }

    let patches: FilePatch[] = [];
    let assistantText = '';
    let applyFailed = false;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: isFirst
          ? 'Spockify Composer generating…'
          : 'Spockify Composer revising…',
        cancellable: true,
      },
      async (_prog, token) => {
        const handle = getRuntimeHandle();
        token.onCancellationRequested(() => {
          handle?.sessions.cancelActive();
        });
        const result = await generateComposerTurn(
          transport,
          session,
          system,
          userContent,
          output,
        );
        assistantText = result.text;
        patches = result.patches;
        applyFailed = result.applyFailed;
        if (result.messages) {
          recordAgentTranscript(session, result.messages);
        }
      },
    );

    if (!patches.length) {
      const doc = await vscode.workspace.openTextDocument({
        content: assistantText || '(empty — tools may have applied already)',
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      if (!assistantText.includes('apply_patch') && !applyFailed) {
        void vscode.window.showWarningMessage(
          'Composer: no path-tagged fences (apply_patch may have run via runtime).',
        );
      }
      if (applyFailed) {
        void vscode.window.showWarningMessage(
          'Composer: apply_patch reported failures — revise to fix.',
        );
      }
      recordTurn(session, userContent, assistantText, []);
    } else {
      recordTurn(session, userContent, assistantText, patches);

      if (shouldAutoApplyFilePatches()) {
        const applied = await autoApplyPatches(patches, output);
        output.appendLine(
          `composer: session files [${session.fileTouchList.join(', ')}] (auto-applied ${applied})`,
        );
        const { getComposerTree } = await import('./composerView');
        getComposerTree()?.clearPending();
      } else if (shadowEnabled()) {
        if (!shadow) {
          shadow = await openShadowForSession(session);
          output.appendLine(`composer: shadow workspace ${shadow.root}`);
        }
        // Iterative stage: latest content per path wins in shadow
        await stagePatchesInShadow(shadow, patches);
      }

      if (!shouldAutoApplyFilePatches()) {
      output.appendLine(
        `composer: session files [${session.fileTouchList.join(', ')}]`,
      );

      const { getComposerTree } = await import('./composerView');
      const tree = getComposerTree();
      tree?.setPending(patches, {
        shadow,
        touchList: session.fileTouchList,
      });

      const { stageInlineFileReview } = await import('../apply/review/inlineReview');
      await stageInlineFileReview(patches, {
        source: 'composer',
        openFirst: true,
        syncTree: false,
        shadow,
      });

      // Also stage Diff Review / Composer tree per reviewMode.
      const mode = getComposerReviewMode();
      output.appendLine(`composer: reviewMode=${mode} pending=${patches.length}`);
      await vscode.commands.executeCommand('spockify.composerView.focus');

      if (mode === 'panel') {
        const applied = (await tree?.openDiffReviewPending()) ?? 0;
        if (applied) {
          output.appendLine(`composer: panel accepted ${applied}`);
        }
      } else if (mode === 'prompt') {
        const how = await vscode.window.showInformationMessage(
          `Composer proposed ${patches.length} file(s) — review in Composer tree or Diff panel.`,
          'Composer tree',
          'Diff review panel',
          'Review files…',
          'Apply all',
        );
        if (
          how === 'Diff review panel' ||
          how === 'Review files…' ||
          how === 'Apply all'
        ) {
          const applied = await applyPatchesWithPreview(patches, output, {
            shadow,
            forceMode:
              how === 'Diff review panel'
                ? 'panel'
                : how === 'Apply all'
                  ? 'all'
                  : 'files',
          });
          if (applied) {
            tree?.clearPending();
          }
        }
      } else {
        // tree — soft toast with Accept all / Diff (non-blocking path after focus)
        void vscode.window
          .showInformationMessage(
            `Composer: ${patches.length} file(s) pending — Accept / Diff / Discard in sidebar`,
            'Accept all',
            'Diff panel',
          )
          .then(async (choice) => {
            if (choice === 'Accept all') {
              await vscode.commands.executeCommand(
                'spockify.composer.acceptAllPending',
              );
            } else if (choice === 'Diff panel') {
              await vscode.commands.executeCommand(
                'spockify.composer.diffReviewPending',
              );
            }
          });
      }

      if (verifyAfterTurnEnabled()) {
        const verify = await vscode.window.showQuickPick(
          [
            { label: 'Skip verify', id: 'skip' },
            { label: 'Run tests (npm test)', id: 'npm' },
            { label: 'Typecheck (npx tsc --noEmit)', id: 'tsc' },
            { label: 'Custom command…', id: 'custom' },
          ],
          { title: 'Composer verify (terminal protocol)' },
        );
        if (
          verify?.id === 'npm' ||
          verify?.id === 'tsc' ||
          verify?.id === 'custom'
        ) {
          let cmd =
            verify.id === 'npm'
              ? 'npm test'
              : verify.id === 'tsc'
                ? 'npx tsc --noEmit'
                : 'npm test';
          if (verify.id === 'custom') {
            cmd =
              (await vscode.window.showInputBox({
                title: 'Verify command',
                value: 'npm test',
              })) || '';
          }
          if (cmd) {
            const { runComposerVerify } = await import('./verify/runVerify');
            const result = await runComposerVerify({ command: cmd }, output);
            output.appendLine(
              `composer verify exit=${result.exitCode} denied=${!!result.denied}`,
            );
            const failed =
              result.denied ||
              (typeof result.exitCode === 'number' && result.exitCode !== 0);
            if (failed) {
              const pick = await vscode.window.showWarningMessage(
                `Verify failed (exit ${result.exitCode ?? 'denied'}). Auto-fix?`,
                'Fix with Composer',
                'Dismiss',
              );
              if (pick === 'Fix with Composer') {
                pendingVerifyFix = formatVerifyFailureContext(cmd, result);
                continue;
              }
            } else {
              void vscode.window.showInformationMessage(
                'Composer verify passed.',
              );
            }
          }
        }
      }
      } // !shouldAutoApplyFilePatches review path
    }

    const { getComposerTree } = await import('./composerView');
    getComposerTree()?.refresh(session.fileTouchList);

    if (pendingVerifyFix) {
      continue;
    }

    const next = await vscode.window.showInformationMessage(
      session.fileTouchList.length
        ? `Composer session — ${session.fileTouchList.length} file(s) touched · shadow ${shadow ? 'on' : 'off'}`
        : 'Composer session',
      'Revise',
      'Done',
    );
    if (next !== 'Revise') {
      break;
    }
  }

  if (shadow) {
    await shadow.writeManifest({
      closedAt: new Date().toISOString(),
      touchList: session.fileTouchList,
    });
    if (!shadow.root.includes(`${path.sep}.spockify${path.sep}shadow`)) {
      await shadow.dispose();
    }
  }
}

export function registerComposer(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.composer', async () => {
      // Cursor-like: Ctrl+I focuses Composer panel input (webview).
      // Legacy InputBox loop remains available via palette "Composer (Multi-file InputBox)".
      try {
        const { getComposerPanel } = await import('./ComposerPanelProvider');
        const panel = getComposerPanel();
        if (panel) {
          await panel.focusInput();
          return;
        }
      } catch {
        /* fall through */
      }
      const transport = await getTransport();
      if (!transport) {
        return;
      }
      try {
        await runComposerSession(transport, output, context);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`composer error: ${msg}`);
        void vscode.window.showErrorMessage(`Spockify Composer failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('spockify.composer.inputBox', async () => {
      const transport = await getTransport();
      if (!transport) {
        return;
      }
      try {
        await runComposerSession(transport, output, context);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`composer error: ${msg}`);
        void vscode.window.showErrorMessage(`Spockify Composer failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('spockify.composer.verify', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'npm test', cmd: 'npm test' },
          { label: 'npx tsc --noEmit', cmd: 'npx tsc --noEmit' },
          { label: 'pytest', cmd: 'pytest' },
          { label: 'Custom…', cmd: '' },
        ],
        { title: 'Composer verify (terminal allowlist / ask policy)' },
      );
      if (!pick) return;
      let cmd = pick.cmd;
      if (!cmd) {
        cmd =
          (await vscode.window.showInputBox({
            title: 'Verify command',
            value: 'npm test',
          })) || '';
      }
      if (!cmd) return;
      const { runComposerVerify } = await import('./verify/runVerify');
      const result = await runComposerVerify({ command: cmd }, output);
      const summary = result.denied
        ? `Denied: ${(result.stderr || 'policy').slice(0, 120)}`
        : `exit ${result.exitCode ?? '?'}`;
      void vscode.window.showInformationMessage(`Composer verify — ${summary}`);
      output.appendLine(
        `composer-verify: ${cmd} → ${summary}\n${(result.stdout || result.stderr || '').slice(0, 2000)}`,
      );
    }),

    vscode.commands.registerCommand(
      'spockify.applyCodeBlock',
      async (code?: string, languageOrPath?: string) => {
        if (!code) {
          return;
        }
        const { isShellFenceLanguage, normalizeProposedShellCommand } =
          await import('../inlineEdit/normalizeShellCommand');
        const { sendCommandToTerminal, hasActiveTerminalInlineEdit } =
          await import('../inlineEdit/terminalInlineEdit');
        const pathLooksLikeFile =
          !!languageOrPath &&
          (languageOrPath.includes('/') ||
            /\.[a-z0-9]+$/i.test(languageOrPath)) &&
          !isShellFenceLanguage(languageOrPath);
        if (
          isShellFenceLanguage(languageOrPath) ||
          (hasActiveTerminalInlineEdit() && !pathLooksLikeFile)
        ) {
          const cmd = normalizeProposedShellCommand(code);
          if (cmd && sendCommandToTerminal(cmd, { execute: true })) {
            void vscode.window.showInformationMessage(
              'Command sent to terminal.',
            );
          }
          return;
        }
        const editor = vscode.window.activeTextEditor;
        if (
          languageOrPath &&
          (languageOrPath.includes('/') || languageOrPath.includes('.'))
        ) {
          await applyPatchesWithPreview(
            [{ path: languageOrPath, content: code }],
            output,
          );
          return;
        }
        if (!editor) {
          if (sendCommandToTerminal(code, { execute: true })) {
            void vscode.window.showInformationMessage(
              'Command sent to terminal.',
            );
            return;
          }
          void vscode.window.showWarningMessage('Open a file to Apply.');
          return;
        }
        const sel = editor.selection;
        if (!sel.isEmpty) {
          await editor.edit((eb) => eb.replace(sel, code));
        } else {
          await editor.edit((eb) => eb.insert(sel.active, code));
        }
      },
    ),
  );
}
