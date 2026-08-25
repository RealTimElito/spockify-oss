/**
 * Terminal agent audit log — Phase 5 WS-P5-P
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface AuditEntry {
  at: string;
  action: 'ask' | 'run' | 'deny' | 'reject';
  command: string;
  reason?: string;
  cwd?: string;
}

export async function appendAuditLog(entry: AuditEntry): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file') {
    return;
  }
  const dir = path.join(folder.uri.fsPath, '.spockify');
  const file = path.join(dir, 'terminal-audit.jsonl');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    /* best-effort */
  }
}

export async function readAuditLog(limit = 50): Promise<AuditEntry[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file') {
    return [];
  }
  const file = path.join(folder.uri.fsPath, '.spockify', 'terminal-audit.jsonl');
  try {
    const text = await fs.readFile(file, 'utf8');
    const lines = text.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as AuditEntry)
      .reverse();
  } catch {
    return [];
  }
}
