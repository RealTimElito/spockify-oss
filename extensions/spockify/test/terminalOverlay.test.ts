/**
 * Unit tests for terminal Ctrl+K overlay HTML markers + host bootstrap contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildTerminalOverlayHtml } from '../src/inlineEdit/terminalOverlayHtml';

describe('terminalOverlayHtml', () => {
  it('embeds Command instructions placeholder and Quick Question chrome', () => {
    const html = buildTerminalOverlayHtml();
    assert.match(html, /Command instructions/);
    assert.match(html, /Quick Question/);
    assert.match(html, /__spockify:\s*'terminalOverlay'/);
    assert.match(html, /id="send"/);
    assert.match(html, /id="close"/);
  });

  it('wires Escape and close to cancel/reject postMessage', () => {
    const html = buildTerminalOverlayHtml();
    assert.match(html, /requestClose/);
    assert.match(html, /Escape/);
    assert.match(html, /type: mode === 'preview' \? 'reject' : 'cancel'/);
    assert.match(html, /autofocus/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /addEventListener\('keydown',\s*function onKeydown/);
  });

  it('escapes custom placeholder HTML', () => {
    const html = buildTerminalOverlayHtml({
      placeholder: 'a <b> & "x"',
    });
    assert.match(html, /a &lt;b&gt; &amp; &quot;x&quot;/);
    assert.doesNotMatch(html, /data-placeholder="a <b>/);
  });
});

describe('terminalOverlay bootstrap (host DOM)', () => {
  it('builds DOM card with host-side Esc/X (no iframe)', () => {
    const boot = path.resolve(
      __dirname,
      '../../../apps/spockify-ide/scripts/patches/terminal-overlay-bootstrap.js',
    );
    const src = fs.readFileSync(boot, 'utf8');
    assert.match(src, /SPOCKIFY_TERMINAL_OVERLAY/);
    assert.match(src, /spockify-to-close/);
    assert.match(src, /requestClose/);
    assert.match(src, /onWorkbenchKeydown/);
    assert.match(src, /document\.addEventListener\('keydown', onWorkbenchKeydown, true\)/);
    assert.doesNotMatch(src, /createElement\('iframe'\)/);
    assert.doesNotMatch(src, /createObjectURL/);
    assert.match(src, /function focusTerminal/);
    assert.match(src, /xterm-helper-textarea/);
    assert.match(src, /workbench\.action\.terminal\.focus/);
    assert.match(src, /'Accept'/);
  });
});
