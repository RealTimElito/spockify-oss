import * as vscode from 'vscode';
import type { AgentRun, AgentWorker, AgentWorkerState } from '@spockify/ide-client';
import {
  AGENT_POLL_MS,
  AGENT_POLL_SYNTH_MS,
  anyRunBusy,
  buildRunMarkdown,
  coerceWorkerResult,
  coerceWorkerState,
  countWorkers,
  isRunBusy,
  pollIntervalForRuns,
  runProgressDescription,
  sanitizeAgentRun,
  sanitizeAgentRunEvent,
  sanitizeAgentRuns,
  sanitizeAgentWorker,
  shouldExpandRun,
  synthesisHeadingLine,
  synthesisTeaser,
  workerProgressDescription,
} from './agentRunLogic';

export {
  AGENT_POLL_MS,
  AGENT_POLL_SYNTH_MS,
  coerceWorkerResult,
  coerceWorkerState,
  sanitizeAgentRun,
  sanitizeAgentRunEvent,
  sanitizeAgentRuns,
  sanitizeAgentWorker,
  anyRunBusy,
  buildRunMarkdown,
  countWorkers,
  isRunBusy,
  pollIntervalForRuns,
  runProgressDescription,
  shouldExpandRun,
  synthesisHeadingLine,
  synthesisTeaser,
  workerProgressDescription,
};

export function workerStateIcon(state?: AgentWorkerState): vscode.ThemeIcon {
  switch (state) {
    case 'running':
      return new vscode.ThemeIcon('sync~spin');
    case 'done':
      return new vscode.ThemeIcon('check');
    case 'failed':
      return new vscode.ThemeIcon('error');
    case 'cancelled':
      return new vscode.ThemeIcon('circle-slash');
    case 'pending':
    default:
      return new vscode.ThemeIcon('clock');
  }
}

export function runStatusIcon(
  run: AgentRun,
  opts?: { cancelling?: boolean },
): vscode.ThemeIcon {
  if (opts?.cancelling) {
    return new vscode.ThemeIcon('loading~spin');
  }
  if (isRunBusy(run.status)) {
    return new vscode.ThemeIcon('sync~spin');
  }
  switch (run.status) {
    case 'done':
      return new vscode.ThemeIcon('check');
    case 'cancelled':
      return new vscode.ThemeIcon('circle-slash');
    case 'failed':
      return new vscode.ThemeIcon('error');
    default:
      return new vscode.ThemeIcon('question');
  }
}

export function workerTooltipMarkdown(
  worker: AgentWorker,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.supportHtml = false;
  const title = worker.name || worker.id;
  md.appendMarkdown(`**${title}** · \`${worker.state || 'pending'}\`\n\n`);
  if (worker.model) {
    md.appendMarkdown(`Model: \`${worker.model}\`\n\n`);
  }
  if (worker.prompt?.trim()) {
    md.appendMarkdown('---\n\n**Prompt**\n\n');
    md.appendMarkdown(worker.prompt.trim().slice(0, 2000));
    md.appendMarkdown('\n\n');
  }
  if (worker.error?.trim()) {
    md.appendMarkdown('---\n\n**Error**\n\n```\n');
    md.appendMarkdown(worker.error.trim().slice(0, 4000));
    md.appendMarkdown('\n```\n\n');
  }
  if (worker.result?.trim()) {
    md.appendMarkdown('---\n\n**Result**\n\n');
    md.appendMarkdown(worker.result.trim().slice(0, 4000));
    if (worker.result.length > 4000) {
      md.appendMarkdown('\n\n_(truncated)_');
    }
  }
  return md;
}

export function runTooltipMarkdown(
  run: AgentRun,
  opts?: { cancelling?: boolean },
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.supportHtml = false;
  const status = opts?.cancelling ? 'stopping…' : run.status;
  md.appendMarkdown(
    `**Agent run** · \`${status}\`\n\n\`${run.id}\`\n\n`,
  );
  if (run.model) {
    md.appendMarkdown(`Model: \`${run.model}\`\n\n`);
  }
  if (run.parent_prompt?.trim()) {
    md.appendMarkdown('**Prompt**\n\n');
    md.appendMarkdown(run.parent_prompt.trim().slice(0, 1500));
    md.appendMarkdown('\n\n');
  }
  const { done, failed, total, active } = countWorkers(run.workers);
  if (total > 0) {
    md.appendMarkdown(
      `**Workers:** ${done}/${total} done` +
        (active ? ` · ${active} live` : '') +
        (failed ? ` · ${failed} failed` : '') +
        '\n\n',
    );
  }
  if (opts?.cancelling) {
    md.appendMarkdown(
      '_Stop requested — waiting for acknowledgement…_\n\n',
    );
  }
  if (run.error?.trim()) {
    md.appendMarkdown('**Error**\n\n```\n');
    md.appendMarkdown(run.error.trim().slice(0, 2000));
    md.appendMarkdown('\n```\n\n');
  }
  if (run.synthesis?.trim()) {
    md.appendMarkdown('**Synthesis**\n\n');
    md.appendMarkdown(run.synthesis.trim().slice(0, 3000));
    if (run.synthesis.length > 3000) {
      md.appendMarkdown('\n\n_(truncated — open run for full)_');
    }
  } else if (run.status === 'synthesizing') {
    md.appendMarkdown('_Synthesis in progress…_\n');
  }
  md.appendMarkdown(
    '\n\n_Click to open · Stop (toolbar) cancels this run only_',
  );
  return md;
}

export function runCollapsibleState(
  run: AgentRun,
): vscode.TreeItemCollapsibleState {
  const workers = run.workers?.length ?? 0;
  if (workers === 0) {
    return vscode.TreeItemCollapsibleState.None;
  }
  if (shouldExpandRun(run)) {
    return vscode.TreeItemCollapsibleState.Expanded;
  }
  return vscode.TreeItemCollapsibleState.Collapsed;
}
