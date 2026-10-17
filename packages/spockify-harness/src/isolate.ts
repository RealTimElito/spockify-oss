/**
 * OS-level isolated runner for shell/test (A-03).
 * Workstation default: none. Production / SPOCKIFY_ISOLATED_RUNNER requires
 * bubblewrap or podman; missing backend fails closed.
 *
 * Production-shaped increment (still not a multi-tenant worker pool):
 * per-job id, no docker/podman socket, cap-drop, network/pid/uts jail,
 * --clearenv, --seccomp BPF (production fail-closed), resource caps.
 * Job admit/audit lives in job.ts.
 * Optional SPOCKIFY_ISOLATE_UID for a mapped nobody-style user
 * after the operator has made the workspace writable to that uid.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  BWRAP_SECCOMP_FD,
  prepareBwrapSeccomp,
} from './seccomp';

export { BWRAP_SECCOMP_FD, encodeSeccompBpf, prepareBwrapSeccomp } from './seccomp';

export type IsolationBackend = 'none' | 'bwrap' | 'podman';

export class IsolationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationRequiredError';
  }
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'bwrap', 'podman']);

/** Host sockets that must never appear in isolated-runner argv. */
export const FORBIDDEN_HOST_BINDS = [
  '/var/run/docker.sock',
  '/run/docker.sock',
  '/var/run/podman/podman.sock',
  '/run/podman/podman.sock',
  '/run/containerd/containerd.sock',
  '/var/run/containerd/containerd.sock',
  '/run/cri-dockerd.sock',
  '/var/run/cri-dockerd.sock',
] as const;

const HOST_ISOLATION_KEYS = [
  'SPOCKIFY_PRODUCTION',
  'SPOCKIFY_PROFILE',
  'SPOCKIFY_ISOLATED_RUNNER',
] as const;

/** Path compose writes so host CLI/IDE pick up production isolation flags. */
export function hostIsolationEnvPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = (env.SPOCKIFY_HOST_ISOLATION_ENV || '').trim();
  if (override) return override;
  const xdg = (env.XDG_CONFIG_HOME || '').trim();
  if (xdg) return path.join(xdg, 'spockify', 'isolation.env');
  const home = (env.HOME || '').trim();
  if (home) return path.join(home, '.config', 'spockify', 'isolation.env');
  return '';
}

export function parseHostIsolationEnvFile(
  raw: string,
): Partial<Record<(typeof HOST_ISOLATION_KEYS)[number], string>> {
  const out: Partial<Record<(typeof HOST_ISOLATION_KEYS)[number], string>> = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if ((HOST_ISOLATION_KEYS as readonly string[]).includes(k)) {
      out[k as (typeof HOST_ISOLATION_KEYS)[number]] = v;
    }
  }
  return out;
}

/**
 * Fill missing isolation flags from the compose-exported host file (G1-13).
 * Process env wins per key. Implicit path uses HOME/XDG only (not os.homedir)
 * so unit tests with a PATH-only env stay workstation-default.
 */
export function mergeHostIsolationEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const p = hostIsolationEnvPath(env);
  if (!p) return env;
  let raw = '';
  try {
    if (!existsSync(p)) return env;
    raw = readFileSync(p, 'utf8');
  } catch {
    return env;
  }
  const parsed = parseHostIsolationEnvFile(raw);
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of HOST_ISOLATION_KEYS) {
    if (!out[k] && parsed[k]) out[k] = parsed[k];
  }
  return out;
}

function isoEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return mergeHostIsolationEnv(env);
}

export function productionRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const e = isoEnv(env);
  return e.SPOCKIFY_PRODUCTION === '1' || e.SPOCKIFY_PROFILE === 'production';
}

export function isolationRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const e = isoEnv(env);
  const raw = (e.SPOCKIFY_ISOLATED_RUNNER || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'off' || raw === 'none') {
    return productionRequested(e);
  }
  return TRUTHY.has(raw);
}

export function preferredBackend(
  env: NodeJS.ProcessEnv = process.env,
): IsolationBackend {
  const e = isoEnv(env);
  const raw = (e.SPOCKIFY_ISOLATED_RUNNER || '').trim().toLowerCase();
  if (raw === 'podman') return 'podman';
  if (raw === 'bwrap' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return 'bwrap';
  }
  if (productionRequested(e)) return 'bwrap';
  return 'none';
}

/** Exported for tests (live bwrap skip). */
export function binaryAvailable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const r = spawnSync('which', [name], {
    encoding: 'utf8',
    env: { PATH: env.PATH || '/usr/bin:/bin' },
  });
  if (r.error) return false;
  return r.status === 0 && Boolean((r.stdout || '').trim());
}

export function resolveIsolation(
  env: NodeJS.ProcessEnv = process.env,
): { backend: IsolationBackend; reason: string } {
  const e = isoEnv(env);
  if (!isolationRequested(e)) {
    return { backend: 'none', reason: 'workstation default (no isolated runner)' };
  }
  const raw = (e.SPOCKIFY_ISOLATED_RUNNER || '').trim().toLowerCase();
  // Explicit backend is fail-closed: do not silently swap bwrap↔podman.
  if (raw === 'podman') {
    if (binaryAvailable('podman', env)) {
      return { backend: 'podman', reason: 'SPOCKIFY_ISOLATED_RUNNER=podman' };
    }
    return {
      backend: 'none',
      reason: 'isolated runner requested (podman) but podman not found',
    };
  }
  if (raw === 'bwrap') {
    if (binaryAvailable('bwrap', env)) {
      return { backend: 'bwrap', reason: 'SPOCKIFY_ISOLATED_RUNNER=bwrap' };
    }
    return {
      backend: 'none',
      reason: 'isolated runner requested (bwrap) but bubblewrap not found',
    };
  }
  if (binaryAvailable('bwrap', env)) {
    return { backend: 'bwrap', reason: 'bubblewrap' };
  }
  if (binaryAvailable('podman', env)) {
    return { backend: 'podman', reason: 'podman' };
  }
  return {
    backend: 'none',
    reason: 'isolated runner requested but bwrap/podman not found',
  };
}

/** Host credentials that must not enter an isolated job environment. */
export const STRIP_ISOLATE_ENV = [
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
  'CONTAINER_HOST',
  'CONTAINER_AUTH_FILE',
  'REGISTRY_AUTH_FILE',
  'KUBECONFIG',
  'KUBE_CONFIG',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'GNUPGHOME',
  'NETRC',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SUDO_ASKPASS',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'LITELLM_MASTER_KEY',
  'POSTGRES_PASSWORD',
  'WEBUI_SECRET_KEY',
  'SEARXNG_SECRET',
] as const;

/**
 * Env for the jail payload: keep PATH/locale/job id, drop credential sockets.
 * bwrap also --clearenv; this covers podman/host spawn helpers.
 */
export function sanitizeIsolateEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if ((STRIP_ISOLATE_ENV as readonly string[]).includes(k)) continue;
    if (
      /(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|AUTHORIZATION|BEARER|API_KEY|CREDENTIAL|_AUTH|AUTH_)/i.test(
        k,
      ) &&
      k !== 'SPOCKIFY_JOB_ID'
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function assertIsolationReady(
  env: NodeJS.ProcessEnv = process.env,
): { backend: IsolationBackend; reason: string } {
  const resolved = resolveIsolation(env);
  if (isolationRequested(env) && resolved.backend === 'none') {
    throw new IsolationRequiredError(
      'isolated runner required (set SPOCKIFY_ISOLATED_RUNNER=bwrap|podman and install bubblewrap or podman)',
    );
  }
  return resolved;
}

const RO_ROOTS = [
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/lib/aarch64-linux-gnu',
  '/lib/x86_64-linux-gnu',
];

/** Minimal /etc — not a host /etc bind (G1-04). */
const ETC_RO_BINDS = [
  '/etc/passwd',
  '/etc/group',
  '/etc/nsswitch.conf',
  '/etc/hosts',
  '/etc/localtime',
  '/etc/ld.so.cache',
  '/etc/ld.so.conf',
  '/etc/ld.so.conf.d',
  '/etc/alternatives',
  '/etc/ssl',
  '/etc/pki',
  '/etc/protocols',
  '/etc/services',
];

const DEV_NODES = ['/dev/null', '/dev/zero', '/dev/urandom', '/dev/random'];

const WORKSPACE_SOCK_RELS = [
  'docker.sock',
  'podman.sock',
  'containerd.sock',
  'cri-dockerd.sock',
  path.join('.docker', 'desktop', 'docker.sock'),
  path.join('var', 'run', 'docker.sock'),
  path.join('run', 'docker.sock'),
  path.join('run', 'containerd', 'containerd.sock'),
];

const DEFAULT_AS_KB = 2 * 1024 * 1024; // 2 GiB virtual
const DEFAULT_NPROC = 256;
const DEFAULT_NOFILE = 256;
const DEFAULT_TMPFS = 64 * 1024 * 1024; // 64 MiB
const DEFAULT_PODMAN_MEMORY = '2g';

function envInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resourcePrelude(env: NodeJS.ProcessEnv = process.env): string {
  const asKb = envInt(env, 'SPOCKIFY_ISOLATE_AS_KB', DEFAULT_AS_KB);
  const nproc = envInt(env, 'SPOCKIFY_ISOLATE_NPROC', DEFAULT_NPROC);
  const nofile = envInt(env, 'SPOCKIFY_ISOLATE_NOFILE', DEFAULT_NOFILE);
  return `ulimit -v ${asKb} -u ${nproc} -n ${nofile} 2>/dev/null; `;
}

export function newJobId(env: NodeJS.ProcessEnv = process.env): string {
  const existing = (env.SPOCKIFY_JOB_ID || '').trim();
  if (existing) return existing.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 48);
  return `j${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

function isolateUid(env: NodeJS.ProcessEnv): string | undefined {
  const uid = (env.SPOCKIFY_ISOLATE_UID || '').trim();
  return uid && /^\d+$/.test(uid) ? uid : undefined;
}

function isolateGid(env: NodeJS.ProcessEnv): string | undefined {
  const gid = (env.SPOCKIFY_ISOLATE_GID || '').trim();
  if (gid && /^\d+$/.test(gid)) return gid;
  return isolateUid(env);
}

function bindSources(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = args[i + 1];
    if (!next) continue;
    if (
      flag === '--bind' ||
      flag === '--ro-bind' ||
      flag === '--dev-bind' ||
      flag === '--bind-try' ||
      flag === '--ro-bind-try' ||
      flag === '--dev-bind-try'
    ) {
      out.push(next);
    }
    if (flag === '-v' || flag === '--volume') {
      out.push(next.split(':')[0] || next);
    }
  }
  return out;
}

function isRuntimeSockRoot(src: string): boolean {
  const n = src.replace(/\/+$/, '') || '/';
  return (
    n === '/run' ||
    n === '/var/run' ||
    n === '/run/docker' ||
    n === '/var/run/docker' ||
    n === '/run/podman' ||
    n === '/var/run/podman'
  );
}

function isForbiddenBind(src: string): boolean {
  if (FORBIDDEN_HOST_BINDS.some((p) => src === p || src.startsWith(`${p}`))) {
    return true;
  }
  if (
    src.endsWith('docker.sock') ||
    src.endsWith('podman.sock') ||
    src.endsWith('containerd.sock') ||
    src.endsWith('cri-dockerd.sock')
  ) {
    return true;
  }
  if (isRuntimeSockRoot(src)) {
    return true;
  }
  if (/\/ssh-[^/]+\/agent\./.test(src)) {
    return true;
  }
  return false;
}

/**
 * Fail closed if argv would mount the host docker/podman socket or SSH agent.
 * Only bind/volume sources are checked — the jail command may mention sockets
 * in an egress probe without mounting them.
 */
export function assertNoForbiddenBinds(args: string[]): void {
  for (const src of bindSources(args)) {
    if (isForbiddenBind(src)) {
      throw new IsolationRequiredError(
        `isolated runner must not bind host socket ${src}`,
      );
    }
  }
}

export type BwrapArgvOpts = {
  /** Open BPF fd inherited as this number (bwrap --seccomp FD). */
  seccompFd?: number;
};

function maskWorkspaceSockets(args: string[], cwd: string): void {
  for (const rel of WORKSPACE_SOCK_RELS) {
    const dest = path.join(cwd, rel);
    if (existsSync(dest)) {
      args.push('--bind', '/dev/null', dest);
    }
  }
}

/** Bubblewrap argv: workspace bind, read-only OS, no net, pid/ipc/uts jail. */
export function bwrapArgv(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: BwrapArgvOpts = {},
): string[] {
  const e = isoEnv(env);
  const tmpfs = envInt(e, 'SPOCKIFY_ISOLATE_TMPFS_BYTES', DEFAULT_TMPFS);
  const jobId = newJobId(e);
  const uid = isolateUid(e);
  const gid = isolateGid(e);
  const seccompFd = opts.seccompFd;
  if (seccompFd === undefined && productionRequested(e)) {
    throw new IsolationRequiredError(
      'bwrap seccomp required in production (set SPOCKIFY_BWRAP_SECCOMP or install a writable runtime dir)',
    );
  }
  const args: string[] = [
    '--die-with-parent',
    '--new-session',
    '--unshare-net',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup-try',
    uid ? '--unshare-user' : '--unshare-user-try',
    '--hostname',
    jobId.slice(0, 32),
    '--proc',
    '/proc',
    '--tmpfs',
    '/dev',
    '--tmpfs',
    '/dev/shm',
    '--size',
    String(tmpfs),
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/run',
    '--tmpfs',
    '/var/run',
    '--bind',
    cwd,
    cwd,
    '--chdir',
    cwd,
    '--clearenv',
    '--setenv',
    'PATH',
    '/usr/bin:/bin:/usr/sbin:/sbin',
    '--setenv',
    'HOME',
    cwd,
    '--setenv',
    'LANG',
    'C.UTF-8',
    '--setenv',
    'LC_ALL',
    'C.UTF-8',
    '--setenv',
    'TERM',
    'dumb',
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'SPOCKIFY_JOB_ID',
    jobId,
    '--cap-drop',
    'ALL',
  ];
  for (const node of DEV_NODES) {
    if (existsSync(node)) args.push('--dev-bind-try', node, node);
  }
  args.push('--symlink', '/proc/self/fd', '/dev/fd');
  args.push('--symlink', '/proc/self/fd/0', '/dev/stdin');
  args.push('--symlink', '/proc/self/fd/1', '/dev/stdout');
  args.push('--symlink', '/proc/self/fd/2', '/dev/stderr');
  if (seccompFd !== undefined) {
    args.push('--seccomp', String(seccompFd));
  }
  if (uid) {
    args.push('--uid', uid);
    args.push('--gid', gid || uid);
  }
  for (const p of RO_ROOTS) {
    if (existsSync(p)) args.push('--ro-bind', p, p);
  }
  for (const p of ETC_RO_BINDS) {
    if (existsSync(p)) args.push('--ro-bind-try', p, p);
  }
  maskWorkspaceSockets(args, cwd);
  args.push('bash', '-lc', resourcePrelude(e) + command);
  assertNoForbiddenBinds(args);
  return args;
}

export function podmanArgv(
  command: string,
  cwd: string,
  image: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const memory = env.SPOCKIFY_ISOLATE_MEMORY || DEFAULT_PODMAN_MEMORY;
  const pids = String(envInt(env, 'SPOCKIFY_ISOLATE_NPROC', DEFAULT_NPROC));
  const jobId = newJobId(env);
  const uid = isolateUid(env);
  const gid = isolateGid(env);
  const tmpfsMb = Math.max(
    8,
    Math.floor(envInt(env, 'SPOCKIFY_ISOLATE_TMPFS_BYTES', DEFAULT_TMPFS) / (1024 * 1024)),
  );
  const args: string[] = [
    'run',
    '--rm',
    '--name',
    `spockify-${jobId}`,
    '--hostname',
    jobId.slice(0, 32),
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--read-only',
    '--tmpfs',
    `/tmp:rw,nosuid,nodev,size=${tmpfsMb}m`,
    '--tmpfs',
    `/var/tmp:rw,nosuid,nodev,size=16m`,
    '--memory',
    memory,
    '--pids-limit',
    pids,
    '--security-opt',
    'no-new-privileges',
    '--env',
    `SPOCKIFY_JOB_ID=${jobId}`,
    '-v',
    `${cwd}:${cwd}:z`,
    '-w',
    cwd,
  ];
  if (uid) {
    args.push('--user', `${uid}:${gid || uid}`);
  }
  args.push('--entrypoint', 'bash', image, '-lc', resourcePrelude(env) + command);
  assertNoForbiddenBinds(args);
  return args;
}

export type IsolatedSpawn = {
  file: string;
  args: string[];
  jobId: string;
  backend: IsolationBackend;
  /** BPF file opened as FD 3 at spawn (bwrap only). */
  seccompPath?: string;
};

export function isolatedSpawn(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): IsolatedSpawn {
  const e = isoEnv(env);
  const { backend } = assertIsolationReady(e);
  const jobId = newJobId(e);
  const jobEnv: NodeJS.ProcessEnv = { ...e, SPOCKIFY_JOB_ID: jobId };
  if (backend === 'none') {
    return { file: 'bash', args: ['-lc', command], jobId, backend };
  }
  if (backend === 'podman') {
    const image =
      e.SPOCKIFY_ISOLATE_IMAGE || 'docker.io/library/python:3.12-slim';
    return {
      file: 'podman',
      args: podmanArgv(command, cwd, image, jobEnv),
      jobId,
      backend,
    };
  }
  let seccompPath: string | undefined;
  try {
    seccompPath = prepareBwrapSeccomp(jobEnv);
  } catch (err) {
    if (productionRequested(jobEnv)) {
      throw new IsolationRequiredError(
        `bwrap seccomp could not be applied: ${(err as Error).message}`,
      );
    }
  }
  return {
    file: 'bwrap',
    args: bwrapArgv(command, cwd, jobEnv, {
      seccompFd: seccompPath ? BWRAP_SECCOMP_FD : undefined,
    }),
    jobId,
    backend,
    seccompPath,
  };
}
