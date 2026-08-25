/**
 * Shell-command vs markdown/prose detector (terminal_run guard).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkShellCommand,
  looksLikeShellCommand,
} from '../src/terminal/isShellCommand';

describe('checkShellCommand', () => {
  it('accepts real shell one-liners', () => {
    for (const cmd of [
      'pwd',
      'ls -la',
      'git status -sb',
      'npm test',
      'python3 -c "print(1)"',
      'kubectl get pods -A',
      'cd safer && pytest -q',
      './scripts/deploy.sh',
    ]) {
      assert.equal(looksLikeShellCommand(cmd), true, cmd);
      assert.equal(checkShellCommand(cmd).ok, true, cmd);
    }
  });

  it('accepts short multi-line scripts', () => {
    const script = ['set -e', 'cd /tmp', 'echo hi', 'ls -la'].join('\n');
    assert.equal(looksLikeShellCommand(script), true);
  });

  it('rejects markdown heading plans (screenshot bug)', () => {
    const prose = [
      '### 2. Integrate into the FastAPI App',
      "In your 'safer/routes' module add BackgroundTasks'.",
    ].join('\n');
    const r = checkShellCommand(prose);
    assert.equal(r.ok, false);
    assert.match(r.reason, /markdown|heading|prose|shell/i);
  });

  it('rejects multi-paragraph essays', () => {
    const essay = [
      'First you should open the project and read the docs carefully.',
      '',
      'Then integrate the FastAPI routes with background tasks as shown below.',
      '',
      'Finally restart the server and verify health.',
    ].join('\n');
    assert.equal(looksLikeShellCommand(essay), false);
  });

  it('rejects empty', () => {
    assert.equal(looksLikeShellCommand('   '), false);
  });
});
