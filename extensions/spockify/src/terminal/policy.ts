import * as vscode from 'vscode';
import type {
  OsSandboxMode,
  TerminalAgentSettings,
  TerminalPolicyMode,
} from './types';
import { checkShellCommand } from './isShellCommand';
import {
  describeTier,
  resolveAllowlist,
  type AllowlistTier,
} from './policy/tiers';

export {
  resolveAllowlist,
  describeTier,
  TIER_READ,
  TIER_DEV,
  TIER_BUILD,
  type AllowlistTier,
} from './policy/tiers';
export {
  checkShellCommand,
  looksLikeShellCommand,
  type ShellCommandCheck,
} from './isShellCommand';

/** Built-in patterns — always denied regardless of allowlist or policy mode. */
const ALWAYS_DENY: RegExp[] = [
  /\brm\s+(-[^\s]+\s+)*(-[^\s]*f[^\s]*\s+)?\/(\s|$)/i,
  /\brm\s+(-[^\s]+\s+)*-rf\s+\/\s*$/im,
  /\brm\s+(-[^\s]+\s+)*-rf\s+\/\*/i,
  /\bmkfs\b/i,
  /\bdd\s+[^|]*\bif\s*=/i,
  /\bcurl\s+[^\n|]+\|\s*(ba)?sh\b/i,
  /\bwget\s+[^\n|]+\|\s*(ba)?sh\b/i,
  /\bcurl\s+[^\n|]+\|\s*sudo\s+(ba)?sh\b/i,
  /\bchmod\s+(-[^\s]+\s+)*777\s+\//i,
  /\bmv\s+[^\s]+\s+\/\s*$/im,
  />\s*\/dev\/sd[a-z]/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bsudo\s+rm\s+(-[^\s]+\s+)*-rf/i,
  /\bformat\s+c:/i,
];

export function loadTerminalAgentSettings(): TerminalAgentSettings {
  const cfg = vscode.workspace.getConfiguration('spockify.terminalAgent');
  const tier = (cfg.get<AllowlistTier>('allowlistTier') ?? 'dev') as AllowlistTier;
  const custom = cfg.get<string[]>('allowlist') ?? [];
  return {
    policy: cfg.get<TerminalPolicyMode>('policy') ?? 'ask',
    allowlistTier: tier,
    allowlist: resolveAllowlist(tier, custom),
    denylist: cfg.get<string[]>('denylist') ?? [],
    timeoutMs: cfg.get<number>('timeoutMs') ?? 60_000,
    maxTurns: cfg.get<number>('maxTurns') ?? 32,
    openTranscript: cfg.get<boolean>('openTranscript') ?? true,
    planApproval: cfg.get<boolean>('planApproval') ?? true,
    showPolicyBadge: cfg.get<boolean>('showPolicyBadge') ?? true,
    osSandbox: (cfg.get<OsSandboxMode>('osSandbox') ?? 'off') as OsSandboxMode,
    osSandboxFailClosed: cfg.get<boolean>('osSandboxFailClosed') ?? false,
  };
}

function patternToRegExp(pattern: string): RegExp | null {
  const p = pattern.trim();
  if (!p) return null;
  if (p.startsWith('re:')) {
    try {
      return new RegExp(p.slice(3), 'i');
    } catch {
      return null;
    }
  }
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$|^${escaped}\\s|${escaped}$`, 'i');
}

function matchesAnyPattern(command: string, patterns: string[]): boolean {
  const normalized = command.replace(/\s+/g, ' ').trim();
  for (const raw of patterns) {
    const re = patternToRegExp(raw);
    if (re?.test(normalized)) return true;
  }
  return false;
}

export function isDangerousCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, ' ').trim();
  if (ALWAYS_DENY.some((re) => re.test(normalized))) return true;
  const { denylist } = loadTerminalAgentSettings();
  return matchesAnyPattern(normalized, denylist);
}

export function isAllowlisted(command: string): boolean {
  const { allowlist } = loadTerminalAgentSettings();
  return matchesAnyPattern(command.replace(/\s+/g, ' ').trim(), allowlist);
}

/** Test helper: evaluate against an explicit allowlist (no vscode). */
export function isAllowlistedAgainst(
  command: string,
  allowlist: string[],
): boolean {
  return matchesAnyPattern(command.replace(/\s+/g, ' ').trim(), allowlist);
}

export type PolicyDecision =
  | { action: 'deny'; reason: string }
  | { action: 'ask'; reason?: string }
  | { action: 'run' };

/**
 * Resolve whether a command may run under the effective policy.
 * Dangerous commands are always denied.
 */
export function evaluateCommandPolicy(
  command: string,
  policy: TerminalPolicyMode,
  allowlistOverride?: string[],
  /** Extra session-scoped patterns (Allow for session). */
  sessionAllow?: string[],
): PolicyDecision {
  const shellCheck = checkShellCommand(command);
  if (!shellCheck.ok) {
    return {
      action: 'deny',
      reason: shellCheck.reason,
    };
  }

  if (isDangerousCommand(command)) {
    return {
      action: 'deny',
      reason: 'Blocked: matches built-in dangerous command patterns (e.g. rm -rf /, mkfs, curl|bash).',
    };
  }

  const baseList = allowlistOverride
    ? allowlistOverride
    : loadTerminalAgentSettings().allowlist;
  const effective = sessionAllow?.length
    ? [...baseList, ...sessionAllow]
    : baseList;
  const onList = isAllowlistedAgainst(command, effective);

  // Session allow still auto-runs even in ask mode (user opted in for this session).
  if (sessionAllow?.length && isAllowlistedAgainst(command, sessionAllow)) {
    return { action: 'run' };
  }

  switch (policy) {
    case 'ask':
      return { action: 'ask' };
    case 'allowlist':
      return onList
        ? { action: 'run' }
        : { action: 'ask', reason: 'Not on allowlist — approval required.' };
    case 'deny':
      return onList
        ? { action: 'run' }
        : {
            action: 'deny',
            reason: 'Strict deny mode: command is not on spockify.terminalAgent.allowlist.',
          };
    default:
      return { action: 'ask' };
  }
}

/** True when every command in a batch can run without prompting. */
export function batchAutoRuns(commands: string[], policy: TerminalPolicyMode): boolean {
  if (policy !== 'allowlist') return false;
  return commands.every((c) => evaluateCommandPolicy(c, policy).action === 'run');
}

export function tierSummaryForPrompt(settings: TerminalAgentSettings): string {
  return `Allowlist tier: ${settings.allowlistTier} (${describeTier(settings.allowlistTier)}); ${settings.allowlist.length} patterns; maxTurns=${settings.maxTurns}; timeoutMs=${settings.timeoutMs}.`;
}
