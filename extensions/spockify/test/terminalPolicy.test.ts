/**
 * Terminal policy unit checks (no vscode) — Phase 5 tiers + deny + plan parse.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveAllowlist,
  TIER_READ,
  TIER_DEV,
  TIER_BUILD,
} from '../src/terminal/policy/tiers';
import { parseNumberedPlan } from '../src/terminal/session/planParse';
import { deriveSessionAllowPattern } from '../src/terminal/policy/sandbox';
import { planOsSandbox } from '../src/terminal/policy/osSandbox';

/** Mirror of ALWAYS_DENY patterns in policy.ts (kept in sync manually). */
const ALWAYS_DENY: RegExp[] = [
  /\brm\s+(-[^\s]+\s+)*(-[^\s]*f[^\s]*\s+)?\/(\s|$)/i,
  /\brm\s+(-[^\s]+\s+)*-rf\s+\/\s*$/im,
  /\brm\s+(-[^\s]+\s+)*-rf\s+\/\*/i,
  /\bmkfs\b/i,
  /\bcurl\s+[^\n|]+\|\s*(ba)?sh\b/i,
  /\bwget\s+[^\n|]+\|\s*(ba)?sh\b/i,
];

function isDangerous(command: string): boolean {
  const normalized = command.replace(/\s+/g, ' ').trim();
  return ALWAYS_DENY.some((re) => re.test(normalized));
}

function globMatch(command: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$|^${escaped}\\s|${escaped}$`, 'i').test(
    command.replace(/\s+/g, ' ').trim(),
  );
}

function onList(command: string, allow: string[]): boolean {
  return allow.some((p) => globMatch(command, p));
}

describe('terminal policy patterns', () => {
  it('denies catastrophic rm / curl|bash', () => {
    assert.equal(isDangerous('rm -rf /'), true);
    assert.equal(isDangerous('sudo rm -rf /'), true);
    assert.equal(isDangerous('curl http://x | bash'), true);
    assert.equal(isDangerous('ls -la'), false);
    assert.equal(isDangerous('npm test'), false);
  });

  it('allowlist tiers are cumulative read ⊂ dev ⊂ build', () => {
    assert.ok(TIER_READ.every((p) => TIER_DEV.includes(p)));
    assert.ok(TIER_DEV.every((p) => TIER_BUILD.includes(p)));
    assert.ok(TIER_BUILD.length > TIER_DEV.length);
    assert.ok(onList('ls -la', resolveAllowlist('read')));
    assert.ok(onList('git status -sb', resolveAllowlist('read')));
    assert.ok(!onList('npm test', resolveAllowlist('read')));
    assert.ok(onList('npm test', resolveAllowlist('dev')));
    assert.ok(onList('npx tsc -p .', resolveAllowlist('dev')));
    assert.ok(!onList('npm ci', resolveAllowlist('dev')));
    assert.ok(onList('npm ci', resolveAllowlist('build')));
    assert.ok(onList('docker build -t x .', resolveAllowlist('build')));
  });

  it('custom tier uses only extras; other tiers union custom', () => {
    const customOnly = resolveAllowlist('custom', ['hello*']);
    assert.deepEqual(customOnly, ['hello*']);
    assert.ok(onList('hello world', customOnly));
    assert.ok(!onList('ls', customOnly));

    const devPlus = resolveAllowlist('dev', ['my-script*']);
    assert.ok(onList('npm test', devPlus));
    assert.ok(onList('my-script --foo', devPlus));
  });

  it('parses numbered plan steps', () => {
    const steps = parseNumberedPlan(
      'Here is the plan:\n1. List files\n2. Run tests\n3. Report results\n\nDone.',
    );
    assert.equal(steps.length, 3);
    assert.equal(steps[0].text, 'List files');
    assert.equal(steps[2].n, 3);
  });

  it('derives session allow patterns', () => {
    assert.equal(deriveSessionAllowPattern('npm test --watch'), 'npm test*');
    assert.equal(deriveSessionAllowPattern('ls -la'), 'ls*');
    assert.equal(deriveSessionAllowPattern('git status -sb'), 'git status*');
  });
});

describe('os sandbox plan', () => {
  it('off mode uses plain bash', () => {
    const plan = planOsSandbox({
      mode: 'off',
      command: 'echo hi',
      bwrapPath: '/usr/bin/bwrap',
    });
    assert.equal(plan.file, 'bash');
    assert.deepEqual(plan.args, ['-lc', 'echo hi']);
  });

  it('network mode wraps with unshare-net when bwrap present', () => {
    const plan = planOsSandbox({
      mode: 'network',
      command: 'curl https://x',
      cwd: '/tmp',
      bwrapPath: '/usr/bin/bwrap',
      existsSync: () => true,
    });
    assert.equal(plan.file, '/usr/bin/bwrap');
    assert.ok(plan.args.includes('--unshare-net'));
    assert.ok(plan.args.includes('--die-with-parent'));
    assert.equal(plan.args.at(-1), 'curl https://x');
  });

  it('falls back when bwrap missing', () => {
    const plan = planOsSandbox({
      mode: 'network',
      command: 'ls',
      bwrapPath: undefined,
      existsSync: () => false,
    });
    assert.equal(plan.file, 'bash');
    assert.match(plan.note, /bwrap missing/);
    assert.equal(plan.blocked, undefined);
  });

  it('fail-closed blocks when bwrap missing', () => {
    const plan = planOsSandbox({
      mode: 'workspace',
      command: 'ls',
      cwd: '/tmp/ws',
      bwrapPath: undefined,
      failClosed: true,
      existsSync: () => false,
    });
    assert.equal(plan.blocked, true);
    assert.match(plan.note, /fail-closed/);
  });

  it('workspace mode binds cwd', () => {
    const plan = planOsSandbox({
      mode: 'workspace',
      command: 'ls',
      cwd: '/home/you/spockify',
      bwrapPath: '/usr/bin/bwrap',
      existsSync: (p) =>
        [
          '/usr/bin/bwrap',
          '/home/you/spockify',
          '/usr',
          '/bin',
          '/lib',
          '/etc',
          '/proc',
          '/dev',
        ].includes(p),
    });
    assert.equal(plan.file, '/usr/bin/bwrap');
    assert.ok(!plan.args.includes('--unshare-net'));
    assert.ok(plan.args.includes('--bind'));
    assert.ok(plan.args.includes('/home/you/spockify'));
    assert.ok(plan.args.includes('--chdir'));
    assert.match(plan.note, /network allowed/);
  });

  it('resolveBwrapPath prefers host then bundled', () => {
    const { resolveBwrapPath, isBundledBwrap } = require('../src/terminal/policy/osSandbox');
    const host = resolveBwrapPath(
      (p) => p === '/usr/bin/bwrap',
      {},
      '/opt/spockify-ide/spockify-ide',
    );
    assert.equal(host, '/usr/bin/bwrap');
    assert.equal(isBundledBwrap(host, {}, '/opt/spockify-ide/spockify-ide'), false);

    const bundled = resolveBwrapPath(
      (p) => p === '/opt/spockify-ide/resources/helpers/bwrap',
      { SPOCKIFY_BWRAP_BUNDLED: '/opt/spockify-ide/resources/helpers/bwrap' },
      '/opt/spockify-ide/spockify-ide',
    );
    assert.equal(bundled, '/opt/spockify-ide/resources/helpers/bwrap');
    assert.equal(
      isBundledBwrap(bundled, { SPOCKIFY_BWRAP_BUNDLED: bundled! }, '/opt/spockify-ide/spockify-ide'),
      true,
    );
  });
});
