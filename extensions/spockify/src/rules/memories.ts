/**
 * Light memories — disk-backed notes injected into chat context.
 * WS-CLONE-H
 */

import * as vscode from 'vscode';

export interface MemoryEntry {
  id: string;
  text: string;
  updatedAt: number;
}

function memoriesUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, 'memories.json');
}

export async function getMemories(
  context: vscode.ExtensionContext,
): Promise<MemoryEntry[]> {
  try {
    const data = await vscode.workspace.fs.readFile(memoriesUri(context));
    const parsed = JSON.parse(Buffer.from(data).toString('utf8')) as MemoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function setMemories(
  context: vscode.ExtensionContext,
  entries: MemoryEntry[],
): Promise<void> {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(
    memoriesUri(context),
    Buffer.from(JSON.stringify(entries, null, 2), 'utf8'),
  );
}

export async function addMemory(
  context: vscode.ExtensionContext,
  text: string,
): Promise<MemoryEntry> {
  const entries = await getMemories(context);
  const entry: MemoryEntry = {
    id: `m_${Date.now().toString(36)}`,
    text: text.trim().slice(0, 2000),
    updatedAt: Date.now(),
  };
  entries.push(entry);
  await setMemories(context, entries.slice(-50));
  return entry;
}

export async function formatMemoriesForPrompt(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const entries = await getMemories(context);
  if (!entries.length) {
    return undefined;
  }
  return entries
    .slice(-20)
    .map((e) => `- ${e.text}`)
    .join('\n')
    .slice(0, 4000);
}
