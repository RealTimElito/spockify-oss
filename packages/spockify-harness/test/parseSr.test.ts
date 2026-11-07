import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bareUnifiedHunkToSrHunks,
  looksLikeBareUnifiedHunk,
  parseSrHunks,
} from '../src/parseSr';

describe('bare unified hunk detection', () => {
  it('recognizes a plain @@ hunk with no wrapper', () => {
    const body = `@@ -1,3 +1,3 @@
 def foo():
-    return 1
+    return 2
`;
    assert.equal(looksLikeBareUnifiedHunk(body), true);
  });

  it('does not claim a Codex-wrapped patch', () => {
    const body = `*** Begin Patch
*** Update File: a.py
@@
-x
+y
*** End Patch
`;
    assert.equal(looksLikeBareUnifiedHunk(body), false);
  });

  it('does not claim a real unified diff with file headers', () => {
    const body = `diff --git a/a.py b/a.py
--- a/a.py
+++ b/a.py
@@ -1,1 +1,1 @@
-x
+y
`;
    assert.equal(looksLikeBareUnifiedHunk(body), false);
  });

  it('does not claim plain SEARCH/REPLACE text', () => {
    const body = 'SEARCH\nfoo\nREPLACE\nbar\n';
    assert.equal(looksLikeBareUnifiedHunk(body), false);
    assert.equal(parseSrHunks(body).hunks.length, 1);
  });
});

describe('bareUnifiedHunkToSrHunks', () => {
  it('converts a single hunk to one SEARCH/REPLACE pair', () => {
    const body = `@@ -1,3 +1,3 @@
 def foo():
-    return 1
+    return 2
`;
    const r = bareUnifiedHunkToSrHunks(body);
    assert.equal(r.hunks.length, 1);
    assert.match(r.hunks[0]!.search, /^def foo\(\):\n {4}return 1\n?$/);
    assert.match(r.hunks[0]!.replace, /^def foo\(\):\n {4}return 2\n?$/);
  });

  it('converts multiple @@ sections in one body to multiple hunks', () => {
    const body = `@@ -1,2 +1,2 @@
 a
-b
+B
@@ -10,2 +10,2 @@
 c
-d
+D
`;
    const r = bareUnifiedHunkToSrHunks(body);
    assert.equal(r.hunks.length, 2);
    assert.equal(r.hunks[0]!.search, 'a\nb');
    assert.equal(r.hunks[0]!.replace, 'a\nB');
    assert.match(r.hunks[1]!.search, /^c\nd\n?$/);
    assert.match(r.hunks[1]!.replace, /^c\nD\n?$/);
  });

  it('errors on an addition-only hunk (no SEARCH context)', () => {
    const body = `@@ -0,0 +1,2 @@
+new line one
+new line two
`;
    const r = bareUnifiedHunkToSrHunks(body);
    assert.equal(r.hunks.length, 0);
    assert.match(r.error || '', /no SEARCH context/);
  });

  it('errors when no @@ header is present', () => {
    const r = bareUnifiedHunkToSrHunks('just some text\n');
    assert.equal(r.hunks.length, 0);
    assert.match(r.error || '', /no @@ hunks found/);
  });
});
