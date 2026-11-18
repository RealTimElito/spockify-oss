/**
 * Tests for LCS unified diffs + Cursor-style collapsed File changes rows.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildUnifiedDiff, buildFileDiffPreview } from '../src/apply/diff';
import {
  collapseUnifiedDiff,
  COLLAPSE_MIN_LINES,
} from '../src/apply/collapsedDiff';
import { findChangedLineSpan } from '../src/apply/lineSpan';

describe('LCS buildUnifiedDiff', () => {
  it('mid-file insert is a small add hunk, not delete-all', () => {
    const prefix = Array.from({ length: 40 }, (_, i) => `keep-${i}`);
    const suffix = Array.from({ length: 40 }, (_, i) => `tail-${i}`);
    const oldC = [...prefix, ...suffix].join('\n') + '\n';
    const insert = Array.from({ length: 12 }, (_, i) => `new-${i}`);
    const newC = [...prefix, ...insert, ...suffix].join('\n') + '\n';
    const u = buildUnifiedDiff('x.py', oldC, newC);
    const del = (u.match(/^-/gm) || []).filter((l) => !l.startsWith('---'))
      .length;
    const add = (u.match(/^\+[^+]/gm) || []).length;
    assert.ok(del < 5, `expected few deletions, got ${del}\n${u}`);
    assert.ok(add >= 12 && add <= 13, `expected ~12 adds, got ${add}\n${u}`);
    assert.match(u, /\+new-0/);
    assert.doesNotMatch(u, /^-keep-0/);
  });

  it('single line replace stays surgical', () => {
    const oldC = 'a\nb\nc\nd\ne\n';
    const newC = 'a\nb\nX\nd\ne\n';
    const preview = buildFileDiffPreview('t.ts', oldC, newC);
    assert.ok(preview.hunks.length >= 1);
    const body = preview.hunks[0]!.lines.join('\n');
    assert.match(body, /^-b|^-c|^\+X/m);
    const dels = preview.hunks[0]!.lines.filter((l) => l.startsWith('-'));
    assert.ok(dels.length <= 2);
  });

  it('does not wipe leading imports on mid-file body edit', () => {
    const imports = [
      'from __future__ import annotations',
      'import os',
      'import smtplib',
      'from email.message import EmailMessage',
      '',
    ];
    const bodyOld = Array.from({ length: 30 }, (_, i) => `    line_${i} = ${i}`);
    const bodyNew = [
      ...bodyOld.slice(0, 10),
      '    safer = True',
      '    client = SmtpClient()',
      ...bodyOld.slice(12),
    ];
    const oldC = [...imports, ...bodyOld].join('\n') + '\n';
    const newC = [...imports, ...bodyNew].join('\n') + '\n';
    const u = buildUnifiedDiff('mail.py', oldC, newC);
    assert.doesNotMatch(u, /^-import /m);
    assert.doesNotMatch(u, /^-from /m);
    const dels = (u.match(/^-/gm) || []).filter((l) => !l.startsWith('---'));
    assert.ok(dels.length <= 4, `unexpected wipe:\n${u}`);
    const span = findChangedLineSpan(oldC, newC);
    assert.ok(span);
    assert.ok(span!.start >= imports.length, `span starts in imports: ${span!.start}`);
  });
});

describe('collapseUnifiedDiff', () => {
  it('collapses long addition runs into +chars … snippet rows', () => {
    const adds = Array.from(
      { length: COLLAPSE_MIN_LINES + 2 },
      (_, i) => `+    subject=email_subject(payload_${i})`,
    );
    const unified = ['--- a/f', '+++ b/f', '@@ -1,0 +1,6 @@', ...adds].join(
      '\n',
    );
    const rows = collapseUnifiedDiff(unified);
    const collapsed = rows.filter((r) => r.kind === 'collapsed');
    assert.ok(collapsed.length >= 1);
    assert.equal(collapsed[0]!.sig, '+');
    assert.match(collapsed[0]!.text, /^\+\d+ …/);
    assert.match(collapsed[0]!.text, /email_subject|subject|payload/);
  });

  it('keeps short edits expanded', () => {
    const unified = [
      '--- a/f',
      '+++ b/f',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');
    const rows = collapseUnifiedDiff(unified);
    assert.equal(rows.filter((r) => r.kind === 'collapsed').length, 0);
    assert.ok(rows.some((r) => r.text === '+new'));
  });
});

describe('findChangedLineSpan', () => {
  it('locates mid-file span for ranged TextEdit', () => {
    const cur = 'a\nb\nc\nd\n';
    const next = 'a\nb\nX\nY\nd\n';
    const span = findChangedLineSpan(cur, next);
    assert.ok(span);
    assert.equal(span!.start, 2);
    assert.equal(span!.oldEnd, 3);
    assert.equal(span!.newEnd, 4);
  });
});
