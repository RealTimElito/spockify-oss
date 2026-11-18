/**
 * Rules hierarchy — project / user / global merge.
 * WS-CLONE-H
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

const PROJECT_FILE_CANDIDATES = [
  '.spockify/rules',
  '.spockify/rules.md',
  '.spockify/RULES.md',
  '.cursorrules',
];

export type RuleLayer = 'global' | 'user' | 'project';

export interface EffectiveRules {
  text: string;
  layers: Array<{ layer: RuleLayer; source: string; chars: number }>;
}

async function readUriText(uri: vscode.Uri, max = 8000): Promise<string | undefined> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(data).toString('utf8').trim();
    return text ? text.slice(0, max) : undefined;
  } catch {
    return undefined;
  }
}

/** Nested `.spockify/rules/**` markdown/text files, sorted by path. */
async function loadRulesDirectory(
  folder: vscode.Uri,
): Promise<{ text: string; sources: string[] }> {
  const dir = vscode.Uri.joinPath(folder, '.spockify', 'rules');
  const sources: string[] = [];
  const chunks: string[] = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    const files = entries
      .filter(([name, type]) => {
        if (type !== vscode.FileType.File) {
          return false;
        }
        return /\.(md|txt|rules)$/i.test(name) || !name.includes('.');
      })
      .map(([name]) => name)
      .sort();
    for (const name of files) {
      const uri = vscode.Uri.joinPath(dir, name);
      const text = await readUriText(uri, 4000);
      if (text) {
        chunks.push(`### ${name}\n${text}`);
        sources.push(`.spockify/rules/${name}`);
      }
    }
  } catch {
    /* no dir */
  }
  return { text: chunks.join('\n\n'), sources };
}

async function loadProjectLayer(
  folder: vscode.Uri,
): Promise<{ text: string; sources: string[] }> {
  const sources: string[] = [];
  const parts: string[] = [];

  const dir = await loadRulesDirectory(folder);
  if (dir.text) {
    parts.push(dir.text);
    sources.push(...dir.sources);
  }

  for (const rel of PROJECT_FILE_CANDIDATES) {
    // Skip if we already loaded from rules/ dir and this is the bare file
    if (rel === '.spockify/rules' && dir.sources.length) {
      continue;
    }
    const uri = vscode.Uri.joinPath(folder, rel);
    const text = await readUriText(uri);
    if (text) {
      parts.push(text);
      sources.push(rel);
      break; // first matching single-file wins among candidates
    }
  }

  return { text: parts.join('\n\n'), sources };
}

function globalRulesPath(): string {
  return path.join(os.homedir(), '.spockify', 'rules.md');
}

export function userRulesStorageUri(
  context: vscode.ExtensionContext,
): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, 'user-rules.md');
}

/** @deprecated prefer userRulesStorageUri */
function userRulesPath(context: vscode.ExtensionContext): vscode.Uri {
  return userRulesStorageUri(context);
}

/**
 * Merge order (low → high precedence, later overrides in prompt layout):
 * global (~/.spockify/rules.md) → user (globalStorage) → project (.spockify/rules*, .cursorrules)
 */
export async function getEffectiveRules(
  context?: vscode.ExtensionContext,
): Promise<EffectiveRules> {
  const layers: EffectiveRules['layers'] = [];
  const blocks: string[] = [];

  // Global
  try {
    const fs = await import('fs/promises');
    const g = await fs.readFile(globalRulesPath(), 'utf8');
    const text = g.trim().slice(0, 6000);
    if (text) {
      blocks.push(`## Global rules\n${text}`);
      layers.push({ layer: 'global', source: globalRulesPath(), chars: text.length });
    }
  } catch {
    /* none */
  }

  // User
  if (context) {
    const text = await readUriText(userRulesPath(context), 6000);
    if (text) {
      blocks.push(`## User rules\n${text}`);
      layers.push({
        layer: 'user',
        source: 'globalStorage/user-rules.md',
        chars: text.length,
      });
    }
  }

  // Project
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    for (const folder of folders) {
      const proj = await loadProjectLayer(folder.uri);
      if (proj.text) {
        blocks.push(`## Project rules\n${proj.text}`);
        for (const s of proj.sources) {
          layers.push({
            layer: 'project',
            source: `${folder.name}/${s}`,
            chars: proj.text.length,
          });
        }
        break;
      }
    }
  }

  return {
    text: blocks.join('\n\n').slice(0, 16_000),
    layers,
  };
}

/** Back-compat: project rules only (string). */
export async function loadProjectRules(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  const proj = await loadProjectLayer(folders[0].uri);
  return proj.text || undefined;
}

export async function writeUserRules(
  context: vscode.ExtensionContext,
  text: string,
): Promise<void> {
  const uri = userRulesPath(context);
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(context.globalStorageUri),
  );
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}
