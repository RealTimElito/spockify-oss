/**
 * Sandbox / policy UX helpers — still ask-default; no silent autonomy.
 * Pure helpers (no vscode) for badges + session allow patterns.
 */

import type { TerminalAgentSettings, TerminalPolicyMode } from '../types';
import {
  describeOsSandbox,
  isBundledBwrap,
  resolveBwrapPath,
} from './osSandbox';
import { describeTier } from './tiers';

export interface SandboxContext {
  cwd?: string;
  policy: TerminalPolicyMode;
  allowlistTier: string;
  sessionId?: string;
  sessionAllowCount?: number;
}

/** One-line badge for approval dialogs and status bar. */
export function formatPolicyBadge(
  settings: TerminalAgentSettings,
  ctx?: Partial<SandboxContext>,
): string {
  const cwd = ctx?.cwd ? shortenPath(ctx.cwd) : 'workspace';
  const session =
    ctx?.sessionAllowCount && ctx.sessionAllowCount > 0
      ? ` · +${ctx.sessionAllowCount} session`
      : '';
  const os = describeOsSandbox(
    settings.osSandbox,
    Boolean(resolveBwrapPath()),
    settings.osSandboxFailClosed,
  );
  return `policy=${settings.policy} · tier=${settings.allowlistTier} · ${os} · cwd=${cwd}${session}`;
}

export function sandboxHintMarkdown(settings: TerminalAgentSettings): string {
  const bwrap = resolveBwrapPath();
  const src = bwrap
    ? isBundledBwrap(bwrap)
      ? 'AppImage-bundled'
      : 'host'
    : undefined;
  let osLine: string;
  if (settings.osSandbox === 'off') {
    osLine =
      '**OS sandbox:** off (set `spockify.terminalAgent.osSandbox` to **workspace** or `network`). Needs `bwrap` — host install or AppImage-bundled helper.';
  } else if (bwrap) {
    osLine = `**OS sandbox:** \`${settings.osSandbox}\` via \`${bwrap}\` (${src}; captured exec only; not integrated terminal / Remote SSH)`;
  } else if (settings.osSandboxFailClosed) {
    osLine = `**OS sandbox:** \`${settings.osSandbox}\` — bwrap missing; **fail-closed** (commands blocked until host \`bubblewrap\` is installed or AppImage helper is present)`;
  } else {
    osLine = `**OS sandbox:** \`${settings.osSandbox}\` requested but bwrap missing — falls back unsandboxed (set \`osSandboxFailClosed\` to deny instead)`;
  }
  return [
    `**Policy:** \`${settings.policy}\` (default ask — opt into \`allowlist\` for auto-run)`,
    `**Tier:** ${describeTier(settings.allowlistTier)}`,
    osLine,
    `**Deny:** dangerous patterns always blocked (rm -rf /, curl|bash, …)`,
    `**Horizon:** maxTurns=${settings.maxTurns}, timeout=${Math.round(settings.timeoutMs / 1000)}s`,
    `**Remote SSH:** OS jail cannot wrap the remote shell from the local IDE; install bubblewrap on the **SSH host** and run agents there for OS isolation (inference still → spockify.eu).`,
  ].join('\n');
}

function shortenPath(p: string): string {
  const home = process.env.HOME;
  if (home && p.startsWith(home)) {
    return `~${p.slice(home.length)}`;
  }
  if (p.length > 48) {
    return `…${p.slice(-45)}`;
  }
  return p;
}

/**
 * Derive a conservative session allow pattern from a command
 * (first token + optional subcommand for npm/git/etc.).
 */
export function deriveSessionAllowPattern(command: string): string {
  const parts = command.replace(/\s+/g, ' ').trim().split(' ');
  if (!parts[0]) return '';
  const bin = parts[0];
  if (
    (bin === 'npm' ||
      bin === 'npx' ||
      bin === 'pnpm' ||
      bin === 'yarn' ||
      bin === 'git') &&
    parts[1]
  ) {
    return `${bin} ${parts[1]}*`;
  }
  return `${bin}*`;
}
