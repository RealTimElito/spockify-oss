/**
 * Single Composer turn — shared by InputBox session loop and Composer webview panel.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { buildAtContext, loadProjectRules, resolveWebSection } from '../rules';
import { parseMentions } from '../rules/mentions';
import {
  createComposerSession,
  historyForNextTurn,
  recordAgentTranscript,
  recordTurn,
} from './session';
import type { ComposerSession } from './types';
import {
  openShadowForSession,
  stagePatchesInShadow,
  type ShadowWorkspaceHandle,
} from './shadowWorkspace';
import { collectComposerPatches } from './collectPatches';
import { textFromContent } from '../chat/chatContent';
import { looksMultiFile, planningNudge } from './plan';
import { getComposerReviewMode } from './reviewMode';
import type { FilePatch } from './types';
import {
  getRuntimeHandle,
  shouldAutoApplyFilePatches,
  stripToolFences,
  DisplayStreamFilter,
  type AgentMessage,
} from '../runtime';
import { getApplyService } from '../apply';

export interface ComposerTurnResult {
  summary: string;
  patchCount: number;
  patches: FilePatch[];
  applyFailed: boolean;
}

/** Module-level session so multi-turn revise works across panel sends. */
let activeSession: ComposerSession | undefined;
let activeShadow: ShadowWorkspaceHandle | undefined;

export function resetComposerPanelSession(): void {
  activeSession = undefined;
  if (activeShadow) {
    const root = activeShadow.root;
    void activeShadow
      .writeManifest({
        closedAt: new Date().toISOString(),
        touchList: [],
      })
      .catch(() => undefined);
    if (!root.includes(`${path.sep}.spockify${path.sep}shadow`)) {
      void activeShadow.dispose();
    }
    activeShadow = undefined;
  }
}

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
    'Prefer explore tools over terminal_run for locating code.',
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

async function attachComposerContext(
  instruction: string,
  extContext?: vscode.ExtensionContext,
  contextTags?: string[],
): Promise<string> {
  const mentions = parseMentions(instruction);
  const tags = new Set(contextTags ?? []);
  let codebaseHits:
    | Array<{ path: string; startLine: number; endLine: number; text: string }>
    | undefined;

  const codebaseCfg = vscode.workspace.getConfiguration('spockify.codebase');
  const explicitCodebase =
    tags.has('codebase') ||
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

  const wantFile =
    tags.has('file') ||
    mentions.kinds.has('file') ||
    mentions.filePaths.length > 0 ||
    true; // Composer always benefits from active file
  const wantSel =
    tags.has('selection') ||
    mentions.kinds.has('selection') ||
    /@selection/i.test(instruction);

  if (wantCodebase) {
    try {
      const { retrieveCodebaseHitsForQuery } = await import(
        '../codebase/retrieveForChat'
      );
      const retrieved = await retrieveCodebaseHitsForQuery(
        mentions.cleanQuery || instruction,
        { pathPrefix: mentions.folderPaths[0], log: undefined },
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

  const webSection = extContext
    ? await resolveWebSection(extContext, instruction)
    : undefined;

  const ctx = await buildAtContext({
    includeSelection: wantSel,
    includeActiveFile: wantFile,
    codebaseHits,
    extraUris,
    context: extContext,
    webSection,
  });
  if (ctx) {
    return `${instruction}\n\n---\n${ctx}\n\n${planningNudge()}`;
  }
  if (wantCodebase && !codebaseHits?.length) {
    return `${instruction}\n\n---\n[@codebase — no hits; try Reindex Codebase]\n\n${planningNudge()}`;
  }
  return `${instruction}\n\n${planningNudge()}`;
}

async function generateComposerTurn(
  transport: ModelTransport,
  session: ComposerSession,
  system: string,
  userContent: string,
  output: vscode.OutputChannel,
  signal?: AbortSignal,
  onStream?: (delta: string) => void,
  modelOverride?: string,
  onAgentEvent?: (event: import('../runtime').AgentRuntimeEvent) => void,
): Promise<{
  text: string;
  patches: FilePatch[];
  applyFailed: boolean;
  messages?: AgentMessage[];
}> {
  const model =
    modelOverride ||
    vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ||
    'spockify-auto';

  const runtimeHandle = getRuntimeHandle();
  if (runtimeHandle) {
    runtimeHandle.refreshMcpBridge();
    const managed = runtimeHandle.sessions.create('agent', 'composer');
    if (signal) {
      const onAbort = () => managed.abort.abort();
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    const history: AgentMessage[] = historyForNextTurn(session);
    history.push({ role: 'user', content: userContent });

    const runtime = runtimeHandle.createRuntime(transport);
    let streamed = '';
    const displayFilter = new DisplayStreamFilter();
    const toolApplyArgs: Array<Record<string, unknown>> = [];
    let applyFailed = false;
    const result = await runtime.run({
      model,
      mode: 'agent',
      systemPrompt: system,
      messages: history,
      maxTurns: 10,
      sessionId: managed.id,
      signal: managed.abort.signal,
      onEvent: (ev) => {
        onAgentEvent?.(ev);
        if (ev.type === 'text' && ev.content) {
          streamed += ev.content;
          if (onStream) {
            const delta = displayFilter.push(ev.content);
            if (delta) onStream(delta);
          }
        }
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
    if (onStream) {
      const tail = displayFilter.flush();
      if (tail) onStream(tail);
    }

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
      `composer: runtime response ${text.length} chars tools=${result.messages.filter((m) => m.role === 'tool').length} patches=${patches.length}`,
    );
    return { text, patches, applyFailed, messages: result.messages };
  }

  const history = historyForNextTurn(session);
  const res = await transport.chatCompletions({
    model,
    messages: [
      { role: 'system', content: system },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ],
    stream: false,
  });
  const text = textFromContent(res.choices?.[0]?.message?.content ?? '');
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

/**
 * Run one Composer instruction (first turn or revise). Stages pending patches.
 */
export async function runComposerInstruction(opts: {
  transport: ModelTransport;
  instruction: string;
  contextTags?: string[];
  output: vscode.OutputChannel;
  extContext?: vscode.ExtensionContext;
  signal?: AbortSignal;
  model?: string;
  onStream?: (delta: string) => void;
  onAgentEvent?: (event: import('../runtime').AgentRuntimeEvent) => void;
}): Promise<ComposerTurnResult> {
  const {
    transport,
    instruction,
    contextTags,
    output,
    extContext,
    signal,
    model,
    onStream,
    onAgentEvent,
  } = opts;

  if (!activeSession) {
    activeSession = createComposerSession();
  }
  const session = activeSession;
  const rules = await loadProjectRules();
  const system = composerSystemPrompt(rules ?? '');

  const isFirst = session.turns.length === 0;
  let userContent: string;
  if (isFirst) {
    userContent = await attachComposerContext(
      instruction,
      extContext,
      contextTags,
    );
  } else if (session.fileTouchList.length) {
    userContent = `${instruction.trim()}\n\nFiles touched in this session: ${session.fileTouchList.join(', ')}\n\n${planningNudge()}`;
  } else {
    userContent = instruction.trim();
  }

  if (signal?.aborted) {
    return { summary: '', patchCount: 0, patches: [], applyFailed: false };
  }

  const result = await generateComposerTurn(
    transport,
    session,
    system,
    userContent,
    output,
    signal,
    onStream,
    model,
    onAgentEvent,
  );

  if (signal?.aborted) {
    return { summary: '', patchCount: 0, patches: [], applyFailed: false };
  }

  if (result.messages) {
    recordAgentTranscript(session, result.messages);
  }

  const patches = result.patches;
  const assistantText = result.text;

  if (!patches.length) {
    recordTurn(session, userContent, assistantText, []);
    const summary =
      stripToolFences(assistantText).slice(0, 1200) ||
      (result.applyFailed
        ? 'apply_patch reported failures — revise to fix.'
        : 'No path-tagged patches (tools may have applied already).');
    return {
      summary,
      patchCount: 0,
      patches: [],
      applyFailed: result.applyFailed,
    };
  }

  recordTurn(session, userContent, assistantText, patches);

  if (shouldAutoApplyFilePatches()) {
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
    const { getComposerTree } = await import('./composerView');
    getComposerTree()?.clearPending();
    getComposerTree()?.refresh(session.fileTouchList);
    const summary =
      stripToolFences(assistantText).slice(0, 800) ||
      `Applied ${result.applied.length} file(s) (unsandboxed).`;
    return {
      summary,
      patchCount: patches.length,
      patches,
      applyFailed: result.rejected.length > 0,
    };
  }

  if (shadowEnabled()) {
    if (!activeShadow) {
      activeShadow = await openShadowForSession(session);
      output.appendLine(`composer: shadow workspace ${activeShadow.root}`);
    }
    await stagePatchesInShadow(activeShadow, patches);
  }

  const { getComposerTree } = await import('./composerView');
  const tree = getComposerTree();
  tree?.setPending(patches, {
    shadow: activeShadow,
    touchList: session.fileTouchList,
  });
  tree?.refresh(session.fileTouchList);

  const { stageInlineFileReview } = await import('../apply/review/inlineReview');
  await stageInlineFileReview(patches, {
    source: 'composer',
    openFirst: true,
    syncTree: false,
    shadow: activeShadow,
  });

  const mode = getComposerReviewMode();
  output.appendLine(`composer: reviewMode=${mode} pending=${patches.length}`);
  await vscode.commands.executeCommand('spockify.composerPanel.focus');

  if (mode === 'panel') {
    await tree?.openDiffReviewPending();
  }

  const summary =
    stripToolFences(assistantText).slice(0, 800) ||
    `Proposed ${patches.length} file(s).`;

  return {
    summary,
    patchCount: patches.length,
    patches,
    applyFailed: result.applyFailed,
  };
}
