/**
 * Terminal OSC/CSI stripping for remote git stdout.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  lastSignificantLine,
  shSingleQuote,
  stripTermSequences,
} from '../src/terminal/termOutput';
import { formatCaughtError } from '../src/util/errors';

describe('stripTermSequences', () => {
  it('strips VS Code shellIntegration OSC 633', () => {
    const raw = '\x1b]633;C\x07true\x1b]633;D;0\x07';
    assert.equal(stripTermSequences(raw).trim(), 'true');
  });

  it('strips CSI colors', () => {
    assert.equal(stripTermSequences('\x1b[31mfatal\x1b[0m').trim(), 'fatal');
  });
});

describe('lastSignificantLine', () => {
  it('returns last non-empty line after strip', () => {
    const raw = '\x1b]633;C\x07\ntrue\n\x1b]633;D;0\x07';
    assert.equal(lastSignificantLine(raw), 'true');
  });
});

describe('shSingleQuote', () => {
  it('escapes embedded single quotes', () => {
    assert.equal(shSingleQuote("it's"), `'it'\\''s'`);
  });
});

describe('formatCaughtError empty Error', () => {
  it('includes stack hint when message blank', () => {
    const err = new Error('');
    err.stack = 'Error\n    at gitExecRemote (gitApi.ts:1:1)';
    const msg = formatCaughtError(err);
    assert.match(msg, /unknown error/i);
    assert.match(msg, /gitExecRemote/);
  });
});
