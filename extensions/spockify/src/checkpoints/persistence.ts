/**
 * Durable checkpoints under `<workspace>/.spockify/checkpoints/<id>/`.
 */

import * as vscode from 'vscode';
import type { Checkpoint } from './store';
import {
  CHECKPOINT_ID_RE,
  sanitizeCheckpointId,
} from './persistenceCore';

export { sanitizeCheckpointId, parseCheckpointIndex } from './persistenceCore';

const INDEX = 'index.json';
const DATA = 'checkpoint.json';
const MAX_ON_DISK = 40;

export function checkpointsRootUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return vscode.Uri.joinPath(folder.uri, '.spockify', 'checkpoints');
}

async function readIndex(root: vscode.Uri): Promise<string[]> {
  try {
    const raw = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(root, INDEX),
    );
    const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as {
      version?: number;
      ids?: string[];
    };
    if (!Array.isArray(parsed.ids)) {
      return [];
    }
    return parsed.ids.filter(
      (id) => typeof id === 'string' && CHECKPOINT_ID_RE.test(id),
    );
  } catch {
    return [];
  }
}

async function writeIndex(root: vscode.Uri, ids: string[]): Promise<void> {
  await vscode.workspace.fs.createDirectory(root);
  const body = Buffer.from(
    JSON.stringify({ version: 1, ids }, null, 0),
    'utf8',
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, INDEX),
    body,
  );
}

async function readCheckpoint(
  root: vscode.Uri,
  id: string,
): Promise<Checkpoint | undefined> {
  try {
    const raw = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(root, sanitizeCheckpointId(id), DATA),
    );
    return JSON.parse(Buffer.from(raw).toString('utf8')) as Checkpoint;
  } catch {
    return undefined;
  }
}

async function deleteCheckpointDir(root: vscode.Uri, id: string): Promise<void> {
  try {
    await vscode.workspace.fs.delete(
      vscode.Uri.joinPath(root, sanitizeCheckpointId(id)),
      { recursive: true, useTrash: false },
    );
  } catch {
    /* best-effort */
  }
}

/** Load checkpoints from disk (oldest → newest). */
export async function loadDurableCheckpoints(): Promise<Checkpoint[]> {
  const root = checkpointsRootUri();
  if (!root) {
    return [];
  }
  const ids = await readIndex(root);
  const out: Checkpoint[] = [];
  for (const id of ids) {
    const cp = await readCheckpoint(root, id);
    if (cp?.id === id && Array.isArray(cp.files)) {
      out.push(cp);
    }
  }
  if (out.length <= MAX_ON_DISK) {
    return out;
  }
  const drop = out.slice(0, out.length - MAX_ON_DISK);
  const keep = out.slice(-MAX_ON_DISK);
  const keepIds = keep.map((c) => c.id);
  for (const cp of drop) {
    await deleteCheckpointDir(root, cp.id);
  }
  await writeIndex(root, keepIds);
  return keep;
}

/** Persist one checkpoint and trim oldest on disk. */
export async function persistCheckpoint(cp: Checkpoint): Promise<void> {
  const root = checkpointsRootUri();
  if (!root) {
    return;
  }
  sanitizeCheckpointId(cp.id);
  const dir = vscode.Uri.joinPath(root, cp.id);
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(dir, DATA),
    Buffer.from(JSON.stringify(cp), 'utf8'),
  );
  let ids = await readIndex(root);
  ids = ids.filter((id) => id !== cp.id);
  ids.push(cp.id);
  while (ids.length > MAX_ON_DISK) {
    const old = ids.shift();
    if (old) {
      await deleteCheckpointDir(root, old);
    }
  }
  await writeIndex(root, ids);
}

export async function removeDurableCheckpoint(id: string): Promise<void> {
  const root = checkpointsRootUri();
  if (!root) {
    return;
  }
  await deleteCheckpointDir(root, id);
  const ids = (await readIndex(root)).filter((x) => x !== id);
  await writeIndex(root, ids);
}

