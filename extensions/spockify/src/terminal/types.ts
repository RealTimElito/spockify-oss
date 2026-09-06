/** §6.5 Terminal tool protocol (WS-CLONE-E). */

export type TerminalPolicyMode = 'ask' | 'allowlist' | 'deny';

export type AllowlistTier = 'read' | 'dev' | 'build' | 'custom';

/** Linux bubblewrap jail for captured exec (opt-in). */
export type OsSandboxMode = 'off' | 'network' | 'workspace';

export interface TerminalToolRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  /** Override `spockify.terminalAgent.policy` for this invocation. */
  policy?: TerminalPolicyMode;
  /** Active terminal-agent session (session allowlist + audit). */
  sessionId?: string;
}

export interface TerminalToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Command blocked by policy (dangerous, deny mode, or user reject). */
  denied?: boolean;
  /** Bubblewrap / exec plan note when captured run was sandboxed. */
  sandboxNote?: string;
}

export interface TerminalAgentSettings {
  policy: TerminalPolicyMode;
  /** Seeded allowlist tier (unioned with custom allowlist unless `custom`). */
  allowlistTier: AllowlistTier;
  allowlist: string[];
  denylist: string[];
  timeoutMs: number;
  maxTurns: number;
  openTranscript: boolean;
  /** Gate tool execution behind numbered-plan approval (Claude Code–class). */
  planApproval: boolean;
  /** Show policy/tier/cwd badge on approval prompts. */
  showPolicyBadge: boolean;
  /**
   * OS sandbox for captured `terminal_run` on Linux (host bwrap).
   * Does not apply to integrated-terminal sendText or Remote SSH.
   */
  osSandbox: OsSandboxMode;
  /**
   * When osSandbox is network|workspace and bwrap/cwd cannot apply,
   * deny the command instead of falling back unsandboxed.
   */
  osSandboxFailClosed: boolean;
}
