/**
 * Pure helpers for @terminal chat context (testable without vscode).
 */

export interface TerminalContextSnapshot {
  name: string;
  selection?: string;
  recentOutput: string;
  isEmpty: boolean;
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9:;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-_]/g, '');
}

export function tailTerminalLines(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1]?.trim()) {
    lines.pop();
  }
  if (lines.length <= maxLines) {
    return lines.join('\n');
  }
  return lines.slice(-maxLines).join('\n');
}

export function formatTerminalContextSection(
  snap: TerminalContextSnapshot | undefined,
): string {
  if (!snap || snap.isEmpty) {
    return '';
  }
  const parts: string[] = [`@terminal (${snap.name}):`];
  if (snap.selection?.trim()) {
    parts.push(
      `Selection:\n\`\`\`\n${snap.selection.slice(0, 6000)}\n\`\`\``,
    );
  }
  if (snap.recentOutput.trim()) {
    parts.push(
      `Recent output:\n\`\`\`\n${snap.recentOutput.slice(0, 14_000)}\n\`\`\``,
    );
  }
  return parts.join('\n\n');
}
