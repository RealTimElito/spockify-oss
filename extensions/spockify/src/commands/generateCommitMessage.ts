/**
 * Spockify: Generate Commit Message — fill SCM input from staged/unstaged diff.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import type { TransportFactory } from './chat';
import {
  COMMIT_MESSAGE_REWRITE_SYSTEM,
  COMMIT_MESSAGE_SYSTEM,
  buildCommitMessageRewritePrompt,
  buildCommitMessageUserPrompt,
  cleanCommitMessage,
  isEmptyDiff,
  isValidConventionalCommit,
} from '../git/commitMessage';
import {
  applyCommitMessage,
  coerceGitRootUri,
  gatherCommitDiff,
  gatherCommitDiffFallback,
  getGitAPI,
  resolveRepository,
  type GatheredDiff,
  type GitRepository,
} from '../git/gitApi';
import { formatCaughtError } from '../util/errors';
import { formatModelAttribution } from '../util/modelAttribution';
import { textFromContent } from '../chat/chatContent';

function defaultModel(): string {
  return (
    vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ||
    'spockify-auto'
  );
}

function isCancellationToken(v: unknown): v is vscode.CancellationToken {
  return (
    !!v &&
    typeof v === 'object' &&
    'isCancellationRequested' in v &&
    typeof (v as vscode.CancellationToken).isCancellationRequested === 'boolean'
  );
}

async function generateFromDiff(
  transport: ModelTransport,
  gathered: GatheredDiff,
  output: vscode.OutputChannel,
): Promise<{ message?: string; attribution: string }> {
  const model = defaultModel();
  if (isEmptyDiff(gathered.diff)) {
    return { attribution: formatModelAttribution(model) };
  }

  const user = buildCommitMessageUserPrompt({
    diff: gathered.diff,
    staged: gathered.staged,
    recentSubjects: gathered.recentSubjects,
    branchName: gathered.branchName,
    repoName: gathered.repoName,
  });

  output.appendLine(
    `git.commitMessage: generating (${gathered.staged ? 'staged' : 'unstaged'}, ` +
      `${gathered.diff.length} chars) model=${model}`,
  );

  const res = await transport.chatCompletions({
    model,
    messages: [
      { role: 'system', content: COMMIT_MESSAGE_SYSTEM },
      { role: 'user', content: user },
    ],
    temperature: 0,
    // Subject + short body; higher budgets invite laundry-list narration.
    max_tokens: 80,
    stop: ['\n- ', '\n* ', '\nWe need', '\nThe diff includes'],
  });

  const used = res.model || model;
  const attribution = formatModelAttribution(model, used);
  let raw = textFromContent(res.choices?.[0]?.message?.content || '');
  let message = cleanCommitMessage(raw);

  // Second pass: model ignored Conventional Commits → ask for a rewrite.
  if (!isValidConventionalCommit(message)) {
    output.appendLine(
      'git.commitMessage: narration detected — requesting rewrite pass',
    );
    try {
      const rewrite = await transport.chatCompletions({
        model,
        messages: [
          { role: 'system', content: COMMIT_MESSAGE_REWRITE_SYSTEM },
          {
            role: 'user',
            content: buildCommitMessageRewritePrompt(raw || message, gathered.diff),
          },
        ],
        temperature: 0,
        max_tokens: 64,
        stop: ['\n- ', '\n* ', '\nWe need', '\nThe diff includes'],
      });
      raw = textFromContent(rewrite.choices?.[0]?.message?.content || '');
      message = cleanCommitMessage(raw);
    } catch (err) {
      output.appendLine(
        `git.commitMessage: rewrite pass failed: ${formatCaughtError(err)}`,
      );
    }
  }

  output.appendLine(
    `git.commitMessage: result ${message.length} chars` +
      (message ? `\n${message.split('\n')[0]}` : ' (empty)') +
      (isValidConventionalCommit(message) ? '' : ' (fallback)') +
      ` · ${attribution}`,
  );
  return { message: message || undefined, attribution };
}

export function registerGenerateCommitMessage(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'spockify.git.generateCommitMessage',
      // SCM spark: (rootUri, context, CancellationToken)
      async (rootUri?: unknown, _scmContext?: unknown, token?: unknown) => {
        try {
          const cancel = isCancellationToken(token) ? token : undefined;
          if (cancel?.isCancellationRequested) {
            output.appendLine('git.commitMessage: cancelled before start');
            return;
          }

          const transport = await getTransport();
          if (!transport) {
            // getTransport already prompts Sign In when possible; never fail silently.
            void vscode.window.showErrorMessage(
              'Spockify: sign in required to generate a commit message.',
            );
            return;
          }

          const api = await getGitAPI(output);
          let repo: GitRepository | undefined;
          let gathered: GatheredDiff | undefined;

          if (api) {
            const uri =
              rootUri instanceof vscode.Uri
                ? rootUri
                : undefined;
            repo = resolveRepository(api, uri);
            if (repo) {
              gathered = await gatherCommitDiff(repo, output);
            }
          }

          if (!gathered) {
            // ui-kind + Remote SSH: vscode.git lives on the workspace host and is
            // invisible here — gather via git CLI on the workspace host instead.
            output.appendLine(
              'git.commitMessage: using workspace-host git CLI fallback',
            );
            gathered = await gatherCommitDiffFallback(rootUri, output);
          }

          if (cancel?.isCancellationRequested) {
            output.appendLine('git.commitMessage: cancelled after gather');
            return;
          }

          if (!gathered) {
            if (!api && !vscode.workspace.workspaceFolders?.length) {
              void vscode.window.showErrorMessage(
                'Open a folder (git repository) to generate a commit message.',
              );
            } else if (!api && vscode.env.remoteName) {
              void vscode.window.showWarningMessage(
                'No git changes found on the remote workspace (or not a git repo).',
              );
            } else if (api && !repo) {
              void vscode.window.showWarningMessage(
                'No git repository found for Generate Commit Message.',
              );
            } else {
              void vscode.window.showInformationMessage(
                'Cannot generate a commit message — no staged or unstaged changes.',
              );
            }
            return;
          }

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Spockify: generating commit message…',
              cancellable: true,
            },
            async (_progress, progressToken) => {
              if (
                cancel?.isCancellationRequested ||
                progressToken.isCancellationRequested
              ) {
                return;
              }
              if (isEmptyDiff(gathered.diff)) {
                void vscode.window.showInformationMessage(
                  'Cannot generate a commit message — no staged or unstaged changes.',
                );
                return;
              }

              const { message, attribution } = await generateFromDiff(
                transport,
                gathered,
                output,
              );
              if (!message) {
                void vscode.window.showWarningMessage(
                  'Spockify returned an empty commit message (see Output → Spockify).',
                );
                return;
              }

              const scmRoot =
                coerceGitRootUri(rootUri) ??
                repo?.rootUri ??
                vscode.workspace.workspaceFolders?.[0]?.uri;
              // Fill SCM input only — never auto-commit.
              const how = await applyCommitMessage(message, repo, scmRoot);
              if (how === 'clipboard') {
                void vscode.window.showInformationMessage(
                  `Commit message copied — paste into Source Control. · ${attribution}`,
                );
              } else {
                void vscode.window.showInformationMessage(
                  `Commit message filled. · ${attribution}`,
                );
              }
            },
          );
        } catch (err) {
          const msg = formatCaughtError(err);
          output.appendLine(`git.commitMessage error: ${msg}`);
          if (err instanceof Error && err.stack) {
            output.appendLine(err.stack.split('\n').slice(0, 6).join('\n'));
          }
          void vscode.window.showErrorMessage(
            `Spockify generate commit message failed: ${msg}`,
          );
        }
      },
    ),
  );
}
