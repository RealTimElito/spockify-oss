import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  JobAdmissionError,
  admitJob,
  auditEvent,
  jobDir,
  listActiveJobs,
  loadJob,
  policyHash,
  redactReason,
  releaseJob,
  workspaceId,
} from '../src/job';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'job-'));
}

function env(
  dir: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SPOCKIFY_JOB_STORE: '1',
    SPOCKIFY_JOB_DIR: dir,
    ...extra,
  };
}

describe('job admission (A-03 control plane)', () => {
  it('records identity hashes, not the workspace path', () => {
    const cwd = tmp();
    const rec = admitJob(cwd, env(path.join(cwd, 'jobs')));
    assert.equal(rec.workspace_id, workspaceId(cwd));
    assert.equal(rec.workspace_id.length, 16);
    assert.doesNotMatch(JSON.stringify(rec), new RegExp(cwd.replace(/[/\\]/g, '.')));
    assert.equal(rec.principal, 'local-operator');
    assert.equal(rec.state, 'running');
    assert.equal(rec.isolation_backend, 'none');
    assert.ok(rec.policy_hash);
    assert.equal(rec.policy_hash, policyHash(env(path.join(cwd, 'jobs'))));
  });

  it('refuses a third job when SPOCKIFY_JOB_MAX=2', () => {
    const cwd = tmp();
    const dir = path.join(cwd, 'jobs');
    const e = env(dir, { SPOCKIFY_JOB_MAX: '2' });
    const a = admitJob(cwd, e);
    const b = admitJob(cwd, { ...e, SPOCKIFY_JOB_ID: 'job-b' });
    assert.equal(listActiveJobs(dir).length, 2);
    assert.throws(
      () => admitJob(cwd, { ...e, SPOCKIFY_JOB_ID: 'job-c' }),
      (err: unknown) => err instanceof JobAdmissionError,
    );
    const rejected = loadJob('job-c', cwd, e);
    assert.equal(rejected?.state, 'rejected');
    const audit = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8');
    assert.match(audit, /job\.admitted/);
    assert.match(audit, /job\.rejected/);
    assert.doesNotMatch(audit, /PASSWORD|SECRET|TOKEN/);
    releaseJob(a.job_id, cwd, e);
    releaseJob(b.job_id, cwd, e);
    assert.equal(listActiveJobs(dir).length, 0);
  });

  it('skips the store on workstation default', () => {
    const cwd = tmp();
    const rec = admitJob(cwd, { PATH: process.env.PATH });
    assert.equal(rec.state, 'running');
    assert.equal(fs.existsSync(jobDir(cwd, { PATH: process.env.PATH })), false);
  });

  it('default job dir is outside the workspace bind', () => {
    const cwd = tmp();
    const dir = jobDir(cwd, { PATH: process.env.PATH, TMPDIR: '/tmp' });
    assert.ok(!dir.startsWith(cwd + path.sep));
    assert.doesNotMatch(dir, /\.spockify\/jobs/);
    const e = env(path.join(cwd, 'jobs'));
    admitJob(cwd, e);
    assert.equal(fs.existsSync(path.join(path.join(cwd, 'jobs'), '.admit.lock')), false);
  });

  it('audit event omits secret-shaped keys', () => {
    const cwd = tmp();
    const dir = path.join(cwd, 'jobs');
    admitJob(cwd, env(dir, { SPOCKIFY_PRINCIPAL: 'operator' }));
    const line = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim();
    const ev = JSON.parse(line) as Record<string, unknown>;
    assert.equal(ev.kind, 'job.admitted');
    assert.ok(ev.job_id);
    assert.equal(ev.workspace_id, workspaceId(cwd));
    assert.equal(ev.principal, undefined);
    assert.equal(ev.model_digest, undefined);
  });

  it('G1-10 redacts secret-shaped values in audit reason', () => {
    assert.equal(
      redactReason('job admission refused: 2 active jobs (max 2)'),
      'job admission refused: 2 active jobs (max 2)',
    );
    assert.equal(
      redactReason('Bearer sk-live-abcdefghijklmnopqrstuvwxyz'),
      'Bearer [redacted]',
    );
    assert.equal(redactReason('API_TOKEN'), '[redacted]');
    const ev = auditEvent('job.rejected', {
      job_id: 'job-x',
      workspace_id: 'abcd',
      state: 'rejected',
      isolation_backend: 'bwrap',
      reason: 'leak ghp_abcdefghijklmnopqrstuvwxyz',
    });
    assert.equal(ev.reason, 'leak [redacted]');
    assert.doesNotMatch(JSON.stringify(ev), /ghp_/);
  });
});
