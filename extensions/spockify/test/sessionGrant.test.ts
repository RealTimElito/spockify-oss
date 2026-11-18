import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeGrantExeArgv,
  sessionCommandGrantKey,
} from '../src/runtime/sessionGrant';

describe('session shell Allow grant', () => {
  it('shares one grant for bash and shell on the same argv', () => {
    const a = sessionCommandGrantKey('s1', 'Run bash', 'bash -lc pytest');
    const b = sessionCommandGrantKey('s1', 'Run shell', 'shell -lc pytest');
    assert.equal(a, b);
    assert.equal(normalizeGrantExeArgv('bash -lc pytest'), 'shell -lc pytest');
    assert.equal(normalizeGrantExeArgv('sh -lc pytest'), 'shell -lc pytest');
  });

  it('does not share grants across sessions', () => {
    const a = sessionCommandGrantKey('s1', 'Run shell', 'pytest');
    const b = sessionCommandGrantKey('s2', 'Run shell', 'pytest');
    assert.notEqual(a, b);
  });
});
