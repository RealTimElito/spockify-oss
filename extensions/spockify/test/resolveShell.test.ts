/**
 * Shell resolution for local captured exec (Remote SSH must not use this path).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickShellFromCandidates } from '../src/terminal/resolveShell';

describe('resolveLocalShell / pickShellFromCandidates', () => {
  it('prefers SHELL when it exists', () => {
    const existing = new Set(['/usr/bin/zsh', '/bin/bash', '/bin/sh']);
    assert.equal(
      pickShellFromCandidates('/usr/bin/zsh', existing, 'linux'),
      '/usr/bin/zsh',
    );
  });

  it('falls back when /bin/bash is missing (ENOENT regression)', () => {
    // Client without /bin/bash (e.g. some non-Linux UI hosts) must not hardcode it.
    const existing = new Set(['/usr/bin/bash', '/bin/sh']);
    assert.equal(
      pickShellFromCandidates('/bin/bash', existing, 'linux'),
      '/usr/bin/bash',
    );
    assert.equal(
      pickShellFromCandidates(undefined, new Set(['/bin/sh']), 'linux'),
      '/bin/sh',
    );
  });

  it('uses cmd.exe on win32', () => {
    assert.equal(
      pickShellFromCandidates(undefined, new Set(), 'win32'),
      'cmd.exe',
    );
  });
});

describe('remote exec routing note', () => {
  it('documents that remoteName skips local spawn', () => {
    // Behavioral guard: planOsSandbox with enabled:false is the OS-jail skip;
    // runTerminalTool must call execOnWorkspaceHost when remote (see remoteExec.ts).
    const { planOsSandbox } = require('../src/terminal/policy/osSandbox');
    const plan = planOsSandbox({
      mode: 'off',
      command: 'echo hi',
      enabled: false,
    });
    assert.match(plan.note, /Remote SSH|OS jail N\/A/);
    assert.equal(plan.mode, 'off');
  });
});
