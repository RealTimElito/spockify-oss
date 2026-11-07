/**
 * Linux OS sandbox MVP for captured terminal_run (bubblewrap).
 * Resolves host bwrap first, then AppImage-bundled helper (if present).
 * Remote SSH / non-Linux: no-op (local namespaces cannot jail the remote shell).
 *
 * Network jail only for `network` mode. `workspace` restricts writable paths but keeps DNS/net.
 * `spockify.terminalAgent.osSandboxFailClosed` blocks instead of unsandboxed run.
 */

import * as fs from 'fs';
import * as path from 'path';

export type OsSandboxMode = 'off' | 'network' | 'workspace';

export interface OsSandboxPlan {
  /** argv for spawn (file + args); empty means run unsandboxed. */
  file: string;
  args: string[];
  mode: OsSandboxMode;
  /** Human note for audit / badge. */
  note: string;
  /** True when fail-closed refused to run unsandboxed. */
  blocked?: boolean;
}

const BWRAP_HOST = ['/usr/bin/bwrap', '/bin/bwrap'];

/** Candidates for AppImage / packaged helper next to the Electron binary. */
export function bundledBwrapCandidates(
  execPath: string = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out: string[] = [];
  const bundledEnv = env.SPOCKIFY_BWRAP_BUNDLED;
  if (bundledEnv) out.push(bundledEnv);
  try {
    const execDir = path.dirname(execPath);
    out.push(path.join(execDir, 'resources', 'helpers', 'bwrap'));
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Resolve bubblewrap binary.
 * Order: SPOCKIFY_BWRAP override → host paths → AppImage-bundled helper.
 */
export function resolveBwrapPath(
  existsSync: (p: string) => boolean = fs.existsSync,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string | undefined {
  const override = env.SPOCKIFY_BWRAP;
  if (override && existsSync(override)) return override;

  for (const p of BWRAP_HOST) {
    if (existsSync(p)) return p;
  }

  for (const p of bundledBwrapCandidates(execPath, env)) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** True when resolved path is the AppImage/helper bundle (not host /usr). */
export function isBundledBwrap(
  resolved: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): boolean {
  if (!resolved) return false;
  if (BWRAP_HOST.includes(resolved)) return false;
  const bundled = new Set(bundledBwrapCandidates(execPath, env));
  if (env.SPOCKIFY_BWRAP_BUNDLED) bundled.add(env.SPOCKIFY_BWRAP_BUNDLED);
  return bundled.has(resolved) || resolved.includes(`${path.sep}helpers${path.sep}bwrap`);
}

export function describeOsSandbox(
  mode: OsSandboxMode,
  available: boolean,
  failClosed = false,
): string {
  if (mode === 'off') return 'os=off';
  if (!available) {
    return failClosed ? `os=${mode}·no-bwrap·fail-closed` : `os=${mode}·no-bwrap`;
  }
  if (mode === 'network') return 'os=net-jail';
  return 'os=workspace+net';
}

/**
 * Build a bwrap spawn plan for a bash -lc command.
 * Returns unsandboxed bash when mode is off, bwrap missing (unless failClosed),
 * or cwd unusable (unless failClosed).
 */
export function planOsSandbox(opts: {
  mode: OsSandboxMode;
  cwd?: string;
  command: string;
  /** Skip when Remote SSH / non-linux. */
  enabled?: boolean;
  bwrapPath?: string | undefined;
  existsSync?: (p: string) => boolean;
  /** When true, refuse unsandboxed fallback if jail cannot be applied. */
  failClosed?: boolean;
}): OsSandboxPlan {
  const enabled = opts.enabled !== false;
  const existsSync = opts.existsSync ?? fs.existsSync;
  const bwrap = opts.bwrapPath ?? resolveBwrapPath(existsSync);
  const failClosed = opts.failClosed === true;

  if (!enabled || opts.mode === 'off') {
    return {
      file: 'bash',
      args: ['-lc', opts.command],
      mode: 'off',
      note: !enabled
        ? 'unsandboxed (Remote SSH / non-Linux — OS jail N/A)'
        : 'unsandboxed',
    };
  }

  if (!bwrap) {
    if (failClosed) {
      return {
        file: 'bash',
        args: ['-lc', 'false'],
        mode: opts.mode,
        note: `fail-closed: bwrap missing (requested ${opts.mode})`,
        blocked: true,
      };
    }
    return {
      file: 'bash',
      args: ['-lc', opts.command],
      mode: opts.mode,
      note: `requested ${opts.mode}; bwrap missing — ran unsandboxed`,
    };
  }

  const cwd = opts.cwd && opts.cwd.length > 0 ? path.resolve(opts.cwd) : undefined;
  if (opts.mode === 'workspace' && (!cwd || !existsSync(cwd))) {
    if (failClosed) {
      return {
        file: 'bash',
        args: ['-lc', 'false'],
        mode: opts.mode,
        note: 'fail-closed: workspace jail needs existing cwd',
        blocked: true,
      };
    }
    return {
      file: 'bash',
      args: ['-lc', opts.command],
      mode: opts.mode,
      note: 'workspace jail needs cwd — ran unsandboxed',
    };
  }

  const args: string[] = ['--die-with-parent'];

  // Network jail only for explicit `network` mode; workspace jail keeps outbound net
  // (npm, curl health checks, etc.) while restricting writable paths.
  if (opts.mode === 'network') {
    args.push('--unshare-net');
  }

  if (opts.mode === 'network') {
    // Full FS, no net. Remount /dev so /dev/null works under bind /.
    args.push('--bind', '/', '/');
    if (existsSync('/proc')) args.push('--proc', '/proc');
    if (existsSync('/dev')) args.push('--dev', '/dev');
  } else {
    // workspace: system RO + workspace RW + no net
    const roRoots = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt'];
    for (const root of roRoots) {
      if (existsSync(root)) args.push('--ro-bind', root, root);
    }
    if (existsSync('/proc')) args.push('--proc', '/proc');
    if (existsSync('/dev')) args.push('--dev', '/dev');
    args.push('--tmpfs', '/tmp');
    // Keep /var/tmp empty-ish
    if (existsSync('/var')) {
      args.push('--tmpfs', '/var');
    }
    args.push('--bind', cwd!, cwd!);
    args.push('--chdir', cwd!);
  }

  args.push('--', 'bash', '-lc', opts.command);

  const source = isBundledBwrap(bwrap) ? 'bundled' : 'host';
  return {
    file: bwrap,
    args,
    mode: opts.mode,
    note:
      opts.mode === 'network'
        ? `bwrap --unshare-net (full FS, ${source})`
        : `bwrap workspace bind ${cwd} (network allowed, ${source})`,
  };
}
