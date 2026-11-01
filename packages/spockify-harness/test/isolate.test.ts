import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  BWRAP_SECCOMP_FD,
  FORBIDDEN_HOST_BINDS,
  IsolationRequiredError,
  assertIsolationReady,
  assertNoForbiddenBinds,
  binaryAvailable,
  bwrapArgv,
  encodeSeccompBpf,
  isolatedSpawn,
  isolationRequested,
  mergeHostIsolationEnv,
  newJobId,
  podmanArgv,
  productionRequested,
  resolveIsolation,
  sanitizeIsolateEnv,
} from '../src/isolate';
import { spawnBashGroup } from '../src/kill';

function env(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function collectChild(command: string, cwd: string, e: NodeJS.ProcessEnv): Promise<string> {
  const child = spawnBashGroup(command, cwd, e);
  let out = '';
  await new Promise<void>((resolve) => {
    child.stdout?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });
    child.on('close', () => resolve());
  });
  return out;
}

describe('isolate', () => {
  it('workstation default is none', () => {
    const e = env({});
    assert.equal(productionRequested(e), false);
    assert.equal(isolationRequested(e), false);
    assert.equal(resolveIsolation(e).backend, 'none');
    const wrap = isolatedSpawn('echo hi', '/tmp', e);
    assert.equal(wrap.file, 'bash');
    assert.ok(wrap.jobId);
  });

  it('production without a backend fails closed', () => {
    const e = env({
      SPOCKIFY_PRODUCTION: '1',
      PATH: '/does-not-exist-for-which',
    });
    assert.equal(isolationRequested(e), true);
    assert.throws(
      () => assertIsolationReady(e),
      (err: unknown) => err instanceof IsolationRequiredError,
    );
  });

  it('bwrap argv binds cwd, unshares net/pid, caps resources, does not bind /', () => {
    const args = bwrapArgv('id', '/work/ws', env({ SPOCKIFY_JOB_ID: 'jobtest1' }));
    assert.ok(args.includes('--unshare-net'));
    assert.ok(args.includes('--unshare-pid'));
    assert.ok(args.includes('--unshare-ipc'));
    assert.ok(args.includes('--unshare-user-try'));
    assert.ok(args.includes('--new-session'));
    assert.ok(args.includes('--size'));
    assert.ok(args.includes('--bind'));
    assert.equal(args[args.indexOf('--bind') + 1], '/work/ws');
    assert.ok(!args.includes('/'));
    assert.ok(args.includes('--hostname'));
    assert.ok(args.includes('jobtest1'));
    assert.ok(args.includes('--cap-drop'));
    assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
    assert.ok(args.includes('--clearenv'));
    assert.ok(!args.includes('SSH_AUTH_SOCK'));
    assert.equal(args[args.indexOf('--setenv') + 1], 'PATH');
    assert.ok(args.includes('/run'));
    assert.ok(args.includes('/var/run'));
    assert.ok(!args.includes('--dev') || args[args.indexOf('--dev') + 1] !== '/dev');
    assert.ok(args.includes('--tmpfs'));
    assert.ok(args.includes('/dev'));
    assert.ok(args.includes('--dev-bind-try'));
    assert.ok(!args.includes('/etc') || args[args.indexOf('--ro-bind-try') + 1] !== '/etc');
    const bashLc = args.at(-1) || '';
    assert.match(bashLc, /ulimit -v /);
    const pod = podmanArgv('id', '/work/ws', 'alpine', env({ SPOCKIFY_JOB_ID: 'jobtest1' }));
    assert.ok(pod.includes('none'));
    assert.ok(pod.includes('--network'));
    assert.ok(pod.includes('--memory'));
    assert.ok(pod.includes('--pids-limit'));
    assert.ok(pod.includes('--cap-drop'));
    assert.ok(pod.includes('--read-only'));
    assert.ok(pod.includes('--name'));
    assert.ok(pod.some((a) => a.startsWith('spockify-jobtest1')));
  });

  it('never mounts docker/podman sockets or the SSH agent', () => {
    const b = bwrapArgv('true', '/work/ws', env({ SPOCKIFY_JOB_ID: 'sock1' }));
    const p = podmanArgv('true', '/work/ws', 'alpine', env({ SPOCKIFY_JOB_ID: 'sock1' }));
    assertNoForbiddenBinds(b);
    assertNoForbiddenBinds(p);
    for (const sock of FORBIDDEN_HOST_BINDS) {
      assert.ok(!b.includes(sock));
      assert.ok(!p.includes(sock));
    }
    assert.throws(
      () => assertNoForbiddenBinds(['-v', '/var/run/docker.sock:/var/run/docker.sock']),
      IsolationRequiredError,
    );
    assert.throws(
      () =>
        assertNoForbiddenBinds(['--bind', '/tmp/ssh-xyz/agent.123', '/tmp/ssh-xyz/agent.123']),
      IsolationRequiredError,
    );
    assert.throws(
      () => assertNoForbiddenBinds(['--bind', '/var/run', '/var/run']),
      IsolationRequiredError,
    );
    assert.throws(
      () =>
        assertNoForbiddenBinds([
          '--bind',
          '/run/containerd/containerd.sock',
          '/run/containerd/containerd.sock',
        ]),
      IsolationRequiredError,
    );
  });

  it('optional SPOCKIFY_ISOLATE_UID maps the job user', () => {
    const e = env({ SPOCKIFY_JOB_ID: 'uid1', SPOCKIFY_ISOLATE_UID: '65534' });
    const b = bwrapArgv('id', '/work/ws', e);
    assert.ok(b.includes('--unshare-user'));
    assert.ok(!b.includes('--unshare-user-try'));
    assert.equal(b[b.indexOf('--uid') + 1], '65534');
    const p = podmanArgv('id', '/work/ws', 'alpine', e);
    assert.ok(p.includes('--user'));
    assert.ok(p.includes('65534:65534'));
  });

  it('SPOCKIFY_ISOLATED_RUNNER=1 without binary throws', () => {
    const e = env({
      SPOCKIFY_ISOLATED_RUNNER: '1',
      PATH: '/does-not-exist-for-which',
    });
    assert.throws(() => isolatedSpawn('echo x', '/tmp', e), IsolationRequiredError);
  });

  it('explicit bwrap does not fall back to podman', () => {
    const e = env({
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
      PATH: '/does-not-exist-for-which',
    });
    const resolved = resolveIsolation(e);
    assert.equal(resolved.backend, 'none');
    assert.match(resolved.reason, /bwrap/);
    assert.throws(() => assertIsolationReady(e), IsolationRequiredError);
  });

  it('explicit podman does not fall back to bwrap', () => {
    const e = env({
      SPOCKIFY_ISOLATED_RUNNER: 'podman',
      PATH: '/does-not-exist-for-which',
    });
    const resolved = resolveIsolation(e);
    assert.equal(resolved.backend, 'none');
    assert.match(resolved.reason, /podman/);
    assert.throws(() => assertIsolationReady(e), IsolationRequiredError);
  });

  it('sanitizeIsolateEnv drops credential sockets and keys', () => {
    const clean = sanitizeIsolateEnv({
      PATH: '/usr/bin',
      SSH_AUTH_SOCK: '/tmp/ssh-agent',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      DOCKER_CONFIG: '/home/me/.docker',
      KUBECONFIG: '/home/me/.kube/config',
      XDG_RUNTIME_DIR: '/run/user/1000',
      GITHUB_TOKEN: 'ghp_nope',
      LITELLM_MASTER_KEY: 'sk-nope',
      AUTHORIZATION: 'Bearer nope',
      BEARER: 'nope',
      CUSTOM_API_KEY: 'sk-nope',
      REGISTRY_AUTH: 'nope',
      GIT_ASKPASS: '/bin/false',
      SSH_ASKPASS: '/bin/false',
      SPOCKIFY_JOB_ID: 'keepme',
    });
    assert.equal(clean.PATH, '/usr/bin');
    assert.equal(clean.SPOCKIFY_JOB_ID, 'keepme');
    assert.equal(clean.SSH_AUTH_SOCK, undefined);
    assert.equal(clean.DOCKER_HOST, undefined);
    assert.equal(clean.DOCKER_CONFIG, undefined);
    assert.equal(clean.KUBECONFIG, undefined);
    assert.equal(clean.XDG_RUNTIME_DIR, undefined);
    assert.equal(clean.GITHUB_TOKEN, undefined);
    assert.equal(clean.LITELLM_MASTER_KEY, undefined);
    assert.equal(clean.AUTHORIZATION, undefined);
    assert.equal(clean.BEARER, undefined);
    assert.equal(clean.CUSTOM_API_KEY, undefined);
    assert.equal(clean.REGISTRY_AUTH, undefined);
    assert.equal(clean.GIT_ASKPASS, undefined);
    assert.equal(clean.SSH_ASKPASS, undefined);
  });

  it('bwrap argv applies seccomp fd and does not bind whole /etc', () => {
    const args = bwrapArgv('true', '/work/ws', env({ SPOCKIFY_JOB_ID: 'sec1' }), {
      seccompFd: BWRAP_SECCOMP_FD,
    });
    assert.ok(args.includes('--seccomp'));
    assert.equal(args[args.indexOf('--seccomp') + 1], String(BWRAP_SECCOMP_FD));
    assert.ok(!args.includes('--dev') || args[args.indexOf('--tmpfs') + 1] === '/dev');
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--ro-bind-try' || args[i] === '--ro-bind') {
        assert.notEqual(args[i + 1], '/etc');
      }
    }
  });

  it('production bwrapArgv without seccomp fails closed', () => {
    assert.throws(
      () =>
        bwrapArgv('true', '/work/ws', env({ SPOCKIFY_PRODUCTION: '1', SPOCKIFY_JOB_ID: 'sec2' })),
      IsolationRequiredError,
    );
  });

  it('production isolatedSpawn without seccomp fails closed', () => {
    const e = env({
      SPOCKIFY_PRODUCTION: '1',
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
      SPOCKIFY_BWRAP_SECCOMP: '0',
      PATH: process.env.PATH,
    });
    assert.throws(
      () => isolatedSpawn('true', '/tmp', e),
      (err: unknown) => err instanceof IsolationRequiredError,
    );
  });

  it('encodeSeccompBpf is a sock_filter program for this arch', () => {
    const bpf = encodeSeccompBpf();
    assert.equal(bpf.length % 8, 0);
    assert.ok(bpf.length >= 40);
    assert.throws(() => encodeSeccompBpf('riscv64'), /unsupported seccomp arch/);
  });

  it('mergeHostIsolationEnv fills missing CLI flags from compose export', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-host-'));
    const file = path.join(dir, 'isolation.env');
    await fs.writeFile(
      file,
      '# generated\nSPOCKIFY_PRODUCTION=1\nSPOCKIFY_ISOLATED_RUNNER=bwrap\nGITHUB_TOKEN=ignore\n',
      'utf8',
    );
    const merged = mergeHostIsolationEnv(
      env({ PATH: '/usr/bin', SPOCKIFY_HOST_ISOLATION_ENV: file }),
    );
    assert.equal(merged.SPOCKIFY_PRODUCTION, '1');
    assert.equal(merged.SPOCKIFY_ISOLATED_RUNNER, 'bwrap');
    assert.equal(merged.GITHUB_TOKEN, undefined);
    assert.equal(isolationRequested(env({ SPOCKIFY_HOST_ISOLATION_ENV: file })), true);
    const override = mergeHostIsolationEnv(
      env({
        SPOCKIFY_HOST_ISOLATION_ENV: file,
        SPOCKIFY_ISOLATED_RUNNER: 'podman',
      }),
    );
    assert.equal(override.SPOCKIFY_ISOLATED_RUNNER, 'podman');
  });

  it('masks a workspace docker.sock bind', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-wsock-'));
    await fs.writeFile(path.join(ws, 'docker.sock'), 'SOCKETSECRET', 'utf8');
    const args = bwrapArgv('true', ws, env({ SPOCKIFY_JOB_ID: 'wsock1' }), {
      seccompFd: BWRAP_SECCOMP_FD,
    });
    const sock = path.join(ws, 'docker.sock');
    const idx = args.indexOf(sock);
    assert.ok(idx > 0);
    assert.equal(args[idx - 1], '/dev/null');
  });

  it('newJobId reuses SPOCKIFY_JOB_ID', () => {
    assert.equal(newJobId(env({ SPOCKIFY_JOB_ID: 'abc_1' })), 'abc_1');
    assert.match(newJobId(env({})), /^j[a-z0-9]+$/);
  });
});

describe('isolate live bwrap', { skip: !binaryAvailable('bwrap') }, () => {
  it('cannot read a file outside the workspace bind', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-'));
    const ws = path.join(root, 'ws');
    const outside = path.join(root, 'secret.txt');
    await fs.mkdir(ws);
    await fs.writeFile(outside, 'SECRET', 'utf8');
    const e = env({
      ...process.env,
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
    });
    const out = await collectChild(`cat ${outside}; echo EXIT:$?`, ws, e);
    assert.doesNotMatch(out, /SECRET/);
  });

  it('cannot read the host docker socket', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-sock-'));
    const e = env({
      ...process.env,
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
      SPOCKIFY_JOB_ID: 'sockprobe',
    });
    const out = await collectChild(
      '(cat /var/run/docker.sock || cat /run/docker.sock) >/dev/null 2>&1; echo SOCK:$?',
      ws,
      e,
    );
    assert.match(out, /SOCK:[1-9]/);
  });

  it('unshare-net blocks egress', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-net-'));
    const e = env({
      ...process.env,
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
    });
    const out = await collectChild(
      '(echo >/dev/tcp/1.1.1.1/53) >/dev/null 2>&1; echo NET:$?',
      ws,
      e,
    );
    assert.match(out, /NET:[1-9]/);
  });

  it('exposes SPOCKIFY_JOB_ID inside the jail', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-job-'));
    const e = env({
      ...process.env,
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
      SPOCKIFY_JOB_ID: 'joblive1',
    });
    const out = await collectChild('printf %s "$SPOCKIFY_JOB_ID"', ws, e);
    assert.match(out, /joblive1/);
  });

  it('does not leak SSH_AUTH_SOCK into the jail', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-ssh-'));
    const e = env({
      ...process.env,
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
      SSH_AUTH_SOCK: '/tmp/fake-ssh-agent',
    });
    const out = await collectChild(
      'printf SOCK=%s; test -z "$SSH_AUTH_SOCK"; echo Z:$?',
      ws,
      e,
    );
    assert.match(out, /SOCK=\s*Z:0/);
  });

  it('applies a seccomp filter that blocks unshare', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-sec-'));
    const e = env({
      ...process.env,
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
      SPOCKIFY_JOB_ID: 'seclive',
    });
    const wrap = isolatedSpawn('true', ws, e);
    assert.ok(wrap.args.includes('--seccomp'));
    assert.ok(wrap.seccompPath);
    const out = await collectChild(
      'unshare -n true >/dev/null 2>&1; echo UNSHARE:$?',
      ws,
      e,
    );
    assert.match(out, /UNSHARE:[1-9]/);
  });

  it('cannot read a workspace docker.sock after mask', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'iso-mask-'));
    await fs.writeFile(path.join(ws, 'docker.sock'), 'SOCKETSECRET', 'utf8');
    const e = env({
      ...process.env,
      SPOCKIFY_ISOLATED_RUNNER: 'bwrap',
    });
    const out = await collectChild(
      'cat docker.sock 2>/dev/null; echo MASKED',
      ws,
      e,
    );
    assert.doesNotMatch(out, /SOCKETSECRET/);
    assert.match(out, /MASKED/);
  });
});
