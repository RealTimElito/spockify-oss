/**
 * Tests for terminal Ctrl+K / shell Apply command normalization.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isShellFenceLanguage,
  normalizeProposedShellCommand,
  unwrapTerminalRunWrapper,
} from '../src/inlineEdit/normalizeShellCommand';

describe('normalizeProposedShellCommand', () => {
  it('returns raw command unchanged', () => {
    assert.equal(
      normalizeProposedShellCommand('kubectl get pods -A'),
      'kubectl get pods -A',
    );
  });

  it('strips markdown fences', () => {
    assert.equal(
      normalizeProposedShellCommand('```bash\nkubectl get pods\n```'),
      'kubectl get pods',
    );
  });

  it('unwraps terminal_run bash "…" hallucinations', () => {
    assert.equal(
      normalizeProposedShellCommand(
        'terminal_run bash "kubectl get pods -n kube-system"',
      ),
      'kubectl get pods -n kube-system',
    );
  });

  it('extracts command from ```tool terminal_run JSON', () => {
    const raw =
      '```tool\n{"name":"terminal_run","arguments":{"command":"ls -la"}}\n```';
    assert.equal(normalizeProposedShellCommand(raw), 'ls -la');
  });

  it('unwraps bare terminal_run bash …', () => {
    assert.equal(
      unwrapTerminalRunWrapper('terminal_run bash kubectl get nodes'),
      'kubectl get nodes',
    );
  });
});

describe('isShellFenceLanguage', () => {
  it('recognizes bash/sh', () => {
    assert.equal(isShellFenceLanguage('bash'), true);
    assert.equal(isShellFenceLanguage('sh'), true);
    assert.equal(isShellFenceLanguage('typescript'), false);
    assert.equal(isShellFenceLanguage('src/foo.ts'), false);
  });
});
