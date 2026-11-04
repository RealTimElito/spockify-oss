/**
 * Single-tenant job identity + admission (plan A-03 control-plane increment).
 *
 * Records one job per isolated spawn, admits against a local concurrency cap,
 * and appends a redacted audit line. This is not a multi-tenant API, quota
 * service, or R4 worker pool. The chat router still must not execute
 * workspace tools.
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  IsolationRequiredError,
  assertIsolationReady,
  isolationRequested,
  newJobId,
  preferredBackend,
  productionRequested,
  type IsolationBackend,
} from './isolate';

export class JobAdmissionError extends IsolationRequiredError {
  constructor(message: string) {
    super(message);
    this.name = 'JobAdmissionError';
  }
}

export type JobState = 'admitted' | 'running' | 'released' | 'rejected';

export type JobResourceBudget = {
  as_kb: number;
  nproc: number;
  nofile: number;
  memory: string;
};

export type JobRecord = {
  job_id: string;
  workspace_id: string;
  principal: string;
  policy_hash: string;
  model_digest: string;
  harness_sha: string;
  resource_budget: JobResourceBudget;
  state: JobState;
  isolation_backend: IsolationBackend;
  created_at: string;
  released_at?: string;
  last_checkpoint?: string;
  reject_reason?: string;
};

const STALE_MS = 2 * 60 * 60 * 1000;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const DEFAULT_AS_KB = 2 * 1024 * 1024;
const DEFAULT_NPROC = 256;
const DEFAULT_NOFILE = 256;

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function jobDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.SPOCKIFY_JOB_DIR || '').trim();
  if (override) return path.resolve(override);
  // Outside the workspace bind so the jail cannot rewrite admission/audit.
  const runtime = (env.XDG_RUNTIME_DIR || '').trim();
  const base = runtime || os.tmpdir();
  return path.join(base, 'spockify-jobs', workspaceId(cwd));
}

export function workspaceId(cwd: string): string {
  return createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 16);
}

export function policyHash(env: NodeJS.ProcessEnv = process.env): string {
  const payload = JSON.stringify({
    production: productionRequested(env),
    isolation: isolationRequested(env),
    backend: preferredBackend(env),
    uid: (env.SPOCKIFY_ISOLATE_UID || '').trim() || undefined,
    gid: (env.SPOCKIFY_ISOLATE_GID || '').trim() || undefined,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function resourceBudget(
  env: NodeJS.ProcessEnv = process.env,
): JobResourceBudget {
  return {
    as_kb: envInt(env, 'SPOCKIFY_ISOLATE_AS_KB', DEFAULT_AS_KB),
    nproc: envInt(env, 'SPOCKIFY_ISOLATE_NPROC', DEFAULT_NPROC),
    nofile: envInt(env, 'SPOCKIFY_ISOLATE_NOFILE', DEFAULT_NOFILE),
    memory: env.SPOCKIFY_ISOLATE_MEMORY || '2g',
  };
}

export function jobMax(env: NodeJS.ProcessEnv = process.env): number {
  if (env.SPOCKIFY_JOB_MAX) return envInt(env, 'SPOCKIFY_JOB_MAX', 2);
  return productionRequested(env) ? 2 : 4;
}

function recordPath(dir: string, jobId: string): string {
  return path.join(dir, `${jobId}.json`);
}

function auditPath(dir: string): string {
  return path.join(dir, 'audit.jsonl');
}

function readRecord(file: string): JobRecord | null {
  try {
    const rec = JSON.parse(readFileSync(file, 'utf8')) as JobRecord;
    if (!rec || typeof rec.job_id !== 'string') return null;
    return rec;
  } catch {
    return null;
  }
}

function writeRecord(dir: string, rec: JobRecord): void {
  mkdirSync(dir, { recursive: true });
  const target = recordPath(dir, rec.job_id);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, target);
}

function withAdmitLock<T>(dir: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, '.admit.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(lockPath, 'wx', 0o600);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      if (Date.now() > deadline) {
        throw new JobAdmissionError('job admission refused: lock timeout');
      }
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        /* raced */
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* persist best-effort */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* persist best-effort */
    }
  }
}

function isSecretKey(key: string): boolean {
  return /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|SOCK|PRIVATE)/i.test(key);
}

/** sk- / ghp_ / github_pat_ tokens stuffed into free text (Bearer prefix kept). */
const SECRET_VALUE = /(?:sk-|ghp_|github_pat_)[A-Za-z0-9._\-]{8,}/g;

/** G1-10: reason is free text; redact secret-shaped values, keep static reject strings. */
export function redactReason(reason: string | undefined): string | undefined {
  if (reason == null) return undefined;
  if (reason === '') return reason;
  if (isSecretKey(reason)) return '[redacted]';
  return reason.replace(SECRET_VALUE, '[redacted]');
}

/** Audit lines never include source, prompts, env, or secret-shaped keys/values. */
export function auditEvent(
  kind: string,
  rec: Pick<JobRecord, 'job_id' | 'workspace_id' | 'state' | 'isolation_backend'> & {
    reason?: string;
  },
): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    kind,
    job_id: rec.job_id,
    workspace_id: rec.workspace_id,
    state: rec.state,
    isolation_backend: rec.isolation_backend,
    reason: redactReason(rec.reason),
  };
}

function appendAudit(dir: string, event: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  for (const key of Object.keys(event)) {
    if (isSecretKey(key)) delete event[key];
  }
  appendFileSync(auditPath(dir), JSON.stringify(event) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function listActiveJobs(
  dir: string,
  now = Date.now(),
): JobRecord[] {
  if (!existsSync(dir)) return [];
  const out: JobRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    const rec = readRecord(file);
    if (!rec) continue;
    if (rec.state === 'released' || rec.state === 'rejected') continue;
    try {
      const st = statSync(file);
      if (now - st.mtimeMs > STALE_MS) continue;
    } catch {
      continue;
    }
    out.push(rec);
  }
  return out;
}

export function releaseJob(
  jobId: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const dir = jobDir(cwd, env);
  const file = recordPath(dir, jobId);
  const rec = existsSync(file) ? readRecord(file) : null;
  if (!rec) return;
  rec.state = 'released';
  rec.released_at = new Date().toISOString();
  writeRecord(dir, rec);
  appendAudit(dir, auditEvent('job.released', rec));
}

/**
 * Admit a job when isolation is requested. Workstation host-bash skips
 * the store unless SPOCKIFY_JOB_STORE=1.
 */
export function admitJob(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): JobRecord {
  const storeOn =
    isolationRequested(env) || (env.SPOCKIFY_JOB_STORE || '').trim() === '1';
  const jobId = newJobId(env);
  const created = new Date().toISOString();
  const backend = isolationRequested(env)
    ? assertIsolationReady(env).backend
    : 'none';
  const rec: JobRecord = {
    job_id: jobId,
    workspace_id: workspaceId(cwd),
    principal: (env.SPOCKIFY_PRINCIPAL || 'local-operator').slice(0, 64),
    policy_hash: policyHash(env),
    model_digest: (env.SPOCKIFY_MODEL_DIGEST || 'unspecified').slice(0, 128),
    harness_sha: (env.SPOCKIFY_HARNESS_SHA || 'unspecified').slice(0, 64),
    resource_budget: resourceBudget(env),
    state: 'admitted',
    isolation_backend: backend,
    created_at: created,
  };
  if (!storeOn) {
    rec.state = 'running';
    return rec;
  }
  const dir = jobDir(cwd, env);
  return withAdmitLock(dir, () => {
    const active = listActiveJobs(dir);
    const max = jobMax(env);
    if (active.length >= max) {
      rec.state = 'rejected';
      rec.reject_reason = `job admission refused: ${active.length} active jobs (max ${max})`;
      writeRecord(dir, rec);
      appendAudit(
        dir,
        auditEvent('job.rejected', { ...rec, reason: rec.reject_reason }),
      );
      throw new JobAdmissionError(rec.reject_reason);
    }
    rec.state = 'running';
    writeRecord(dir, rec);
    appendAudit(dir, auditEvent('job.admitted', rec));
    return rec;
  });
}

export function loadJob(
  jobId: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): JobRecord | null {
  return readRecord(recordPath(jobDir(cwd, env), jobId));
}

export function unlinkJobFiles(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    unlinkSync(path.join(dir, name));
  }
}
