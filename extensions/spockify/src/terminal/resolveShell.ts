/**
 * Resolve a login shell for *local* child_process.spawn.
 * Never use this for Remote SSH — ui-kind extensions must not spawn on the client.
 */

import * as fs from 'fs';
import * as path from 'path';

const POSIX_CANDIDATES = [
  '/bin/bash',
  '/usr/bin/bash',
  '/bin/zsh',
  '/usr/bin/zsh',
  '/bin/sh',
  '/usr/bin/sh',
];

/**
 * Absolute shell path for local captured exec.
 * Prefers $SHELL when it exists, then common bash/zsh/sh locations.
 */
export function resolveLocalShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  existsSync: (p: string) => boolean = fs.existsSync,
): string {
  if (platform === 'win32') {
    return env.ComSpec || env.COMSPEC || 'cmd.exe';
  }

  const fromEnv = env.SHELL?.trim();
  if (fromEnv && (path.isAbsolute(fromEnv) ? existsSync(fromEnv) : true)) {
    if (!path.isAbsolute(fromEnv) || existsSync(fromEnv)) {
      return fromEnv;
    }
  }

  for (const candidate of POSIX_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Last resort — may still ENOENT; caller surfaces spawn errors.
  return fromEnv || '/bin/sh';
}

/** Pure helper for unit tests (no fs). */
export function pickShellFromCandidates(
  shellEnv: string | undefined,
  existing: ReadonlySet<string>,
  platform: NodeJS.Platform = 'linux',
): string {
  if (platform === 'win32') {
    return 'cmd.exe';
  }
  if (shellEnv && existing.has(shellEnv)) {
    return shellEnv;
  }
  for (const candidate of POSIX_CANDIDATES) {
    if (existing.has(candidate)) {
      return candidate;
    }
  }
  return shellEnv || '/bin/sh';
}
