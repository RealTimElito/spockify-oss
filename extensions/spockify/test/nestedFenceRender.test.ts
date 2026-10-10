/**
 * Nested markdown fence unwrapping — mirrors chat.js helpers (keep in sync).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function unwrapNestedLanguageFences(text: string): string {
  let s = String(text || '');
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/```([a-zA-Z0-9_+-]*)\s*\n```\1\s*\n/g, '```$1\n')
      .replace(/```\s*\n```([a-zA-Z0-9_+-]+)\s*\n/g, '```$1\n');
    if (next === s) break;
    s = next;
  }
  return s;
}

function stripInnerFenceFromCode(code: string): string {
  const raw = String(code || '');
  const trimmed = raw.trim();
  const full = /^```([^\n]*)\n([\s\S]*?)```\s*$/.exec(trimmed);
  if (full) return full[2].replace(/\n$/, '');
  const open = /^```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*)$/.exec(raw);
  if (open) return open[2].replace(/\n$/, '');
  return raw.replace(/\n$/, '');
}

function extractFences(text: string): Array<{ hint: string; code: string }> {
  const cleaned = unwrapNestedLanguageFences(text);
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  const out: Array<{ hint: string; code: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const code = stripInnerFenceFromCode(m[2]);
    if (!code.trim()) continue;
    out.push({ hint: (m[1] || '').trim(), code });
  }
  return out;
}

describe('nested language fences', () => {
  it('collapses ```python\\n```python into one fence', () => {
    const raw =
      'Here is STFT:\n\n```python\n```python\nstft = tf.signal.stft(\n    signals\n)\n```';
    const fences = extractFences(raw);
    assert.equal(fences.length, 1);
    assert.equal(fences[0].hint, 'python');
    assert.match(fences[0].code, /stft = tf\.signal\.stft/);
    assert.ok(!fences[0].code.includes('```'));
  });

  it('keeps path cite + single python fence body', () => {
    const raw =
      'See safer/train.py lines 365-424:\n\n```python\nstft = tf.signal.stft(\n)\n```';
    const fences = extractFences(raw);
    assert.equal(fences.length, 1);
    assert.equal(fences[0].code.trim(), 'stft = tf.signal.stft(\n)');
  });

  it('handles Cursor start:end:path fence hint', () => {
    const raw = '```365:424:safer/train.py\nstft = 1\n```';
    const fences = extractFences(raw);
    assert.equal(fences.length, 1);
    assert.equal(fences[0].hint, '365:424:safer/train.py');
  });
});
