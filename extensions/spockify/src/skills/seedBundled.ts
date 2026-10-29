/**
 * Seed the extension's bundled skills into the workspace .spockify/skills
 * directory on activation. Existing user skills are never overwritten.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export async function seedBundledSkills(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;

  const bundledRoot = path.join(context.extensionPath, 'bundled-skills');
  let entries: string[];
  try {
    entries = await fs.readdir(bundledRoot);
  } catch {
    output.appendLine('[skills] no bundled-skills directory found');
    return;
  }

  for (const folder of folders) {
    const destRoot = path.join(folder.uri.fsPath, '.spockify', 'skills');
    await fs.mkdir(destRoot, { recursive: true });
    let seeded = 0;
    for (const name of entries) {
      const src = path.join(bundledRoot, name, 'SKILL.md');
      const destDir = path.join(destRoot, name);
      const dest = path.join(destDir, 'SKILL.md');
      try {
        await fs.access(src);
      } catch {
        continue;
      }
      try {
        await fs.access(dest);
        continue;
      } catch {
        /* not present, seed it */
      }
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(src, dest);
      seeded++;
    }
    if (seeded) {
      output.appendLine(
        `[skills] seeded ${seeded} bundled skill(s) into ${destRoot}`,
      );
    }
  }
}

/** Absolute path to the extension's bundled skills (always available). */
export function bundledSkillsDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, 'bundled-skills');
}
