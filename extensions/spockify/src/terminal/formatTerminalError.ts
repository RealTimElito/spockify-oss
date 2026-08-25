/**
 * Human hints for terminal_run tool cards and agent follow-ups.
 */

import type { TerminalToolResult } from './types';

export function formatTerminalRunError(
  result: Pick<TerminalToolResult, 'exitCode' | 'stdout' | 'stderr' | 'denied'>,
  opts?: { osSandboxNote?: string },
): string | undefined {
  if (result.denied) {
    return result.stderr || 'denied';
  }
  if (result.exitCode === 0) {
    return undefined;
  }

  const stderr = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  const parts: string[] = [`exit ${result.exitCode}`];

  if (result.exitCode === 127) {
    parts.push(
      'command not found — use python3 (not python), or install the binary on PATH',
    );
  } else if (result.exitCode === 124) {
    parts.push('timed out');
  }

  if (/spawn .+ ENOENT|ENOENT/i.test(stderr) && /bash|shell/i.test(stderr)) {
    parts.push(
      'shell missing on this host — under Remote SSH, upgrade Spockify IDE (0.7.5+) so terminal_run uses the remote terminal, not local /bin/bash',
    );
  }

  if (
    /Name or service not known|Temporary failure in name resolution|Network is unreachable|Could not resolve host/i.test(
      stderr,
    )
  ) {
    parts.push(
      'DNS/network failed — if `spockify.terminalAgent.osSandbox` is `network`, outbound net is blocked; use `off` or `workspace` for curl/python checks',
    );
  }

  if (opts?.osSandboxNote && /unshare-net/i.test(opts.osSandboxNote)) {
    parts.push('ran under bubblewrap with no network (--unshare-net)');
  }

  if (stderr) {
    const line = stderr.split('\n').find((l) => l.trim())?.trim();
    if (line) {
      parts.push(line.slice(0, 240));
    }
  }

  return parts.join(' · ');
}
