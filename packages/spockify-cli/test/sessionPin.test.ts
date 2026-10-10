import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderStatusLine } from '../src/ui';

describe('CLI session pin header', () => {
  it('prints harness= · tag · think=', () => {
    const line = renderStatusLine({
      model: 'gpt-oss-20b',
      mode: 'agent',
      yolo: false,
      thinking: 'low',
      cwd: '/tmp',
      turns: 0,
      harnessId: 'spockify',
    });
    assert.match(line, /harness=spockify/);
    assert.match(line, /gpt-oss-20b/);
    assert.match(line, /think=low/);
  });

  it('warns when the session model is devstral-2', () => {
    const line = renderStatusLine({
      model: 'devstral-2',
      mode: 'agent',
      yolo: false,
      thinking: 'off',
      cwd: '/tmp',
      turns: 0,
      harnessId: 'spockify',
    });
    assert.match(line, /devstral-2/);
    assert.match(line, /evicts 120b-hot/);
  });

  it('prints auto → tag think= after the session picker', () => {
    const line = renderStatusLine({
      model: 'gpt-oss-20b',
      mode: 'agent',
      yolo: false,
      thinking: 'off',
      cwd: '/tmp',
      turns: 0,
      harnessId: 'spockify',
      autoPicked: true,
    });
    assert.match(line, /auto → gpt-oss-20b think=off/);
  });
});
