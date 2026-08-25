/**
 * Regression tests for Spockify IDE AppImage update version axis.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractCandidate,
  isNewer,
  parseSemverish,
  pickHighestVersion,
} from '../src/update/version';

describe('parseSemverish', () => {
  it('parses plain and v-prefixed versions', () => {
    assert.deepEqual(parseSemverish('0.7.2'), [0, 7, 2]);
    assert.deepEqual(parseSemverish('v0.7.2'), [0, 7, 2]);
  });

  it('falls back to zeros for garbage', () => {
    assert.deepEqual(parseSemverish(''), [0, 0, 0]);
    assert.deepEqual(parseSemverish('not-a-version'), [0, 0, 0]);
  });
});

describe('isNewer', () => {
  it('same version → not newer', () => {
    assert.equal(isNewer('0.7.2', '0.7.2'), false);
  });

  it('remote patch ahead → newer', () => {
    assert.equal(isNewer('0.7.2', '0.7.1'), true);
  });

  it('remote behind → not newer', () => {
    assert.equal(isNewer('0.7.1', '0.7.2'), false);
  });

  it('does not treat productVersion as newer than spockifyIdeVersion', () => {
    // Guard: if someone compared product 1.129.1 vs extension 0.7.2 wrongly,
    // product looks "newer"; clients must never use product as remote axis.
    assert.equal(isNewer('1.129.1', '0.7.2'), true);
    assert.equal(isNewer('0.7.2', '1.129.1'), false);
  });

  it('0.0.0 local looks outdated (fallback must not be used when installed)', () => {
    assert.equal(isNewer('0.7.2', '0.0.0'), true);
  });

  it('0.8.1 feed vs 0.8.1 local → not newer', () => {
    assert.equal(isNewer('0.8.1', '0.8.1'), false);
  });
});

describe('pickHighestVersion', () => {
  it('prefers higher patch', () => {
    assert.equal(pickHighestVersion('0.8.0', '0.8.1'), '0.8.1');
    assert.equal(pickHighestVersion(undefined, '0.8.1', '0.8.0'), '0.8.1');
  });
});

describe('extractCandidate', () => {
  const arch = 'x86_64';

  it('prefers spockifyIdeVersion over productVersion', () => {
    const c = extractCandidate(
      {
        spockifyIdeVersion: '0.7.2',
        version: '0.7.2',
        productVersion: '1.129.1',
        downloadUrl: 'https://example/Spockify-IDE-0.7.2-x86_64.AppImage',
      },
      arch,
    );
    assert.ok(c);
    assert.equal(c!.version, '0.7.2');
  });

  it('ignores bare version when it equals productVersion', () => {
    const c = extractCandidate(
      {
        version: '1.129.1',
        productVersion: '1.129.1',
        downloadUrl: 'https://example/Spockify-IDE-1.129.1-x86_64.AppImage',
      },
      arch,
    );
    assert.equal(c, undefined);
  });

  it('live-shaped feed: equal installed → not newer', () => {
    const c = extractCandidate(
      {
        spockifyIdeVersion: '0.7.2',
        appImageVersion: '0.7.2',
        version: '0.7.2',
        productVersion: '1.129.1',
        downloadUrl:
          'https://spockify.eu/downloads/Spockify-IDE-0.7.2-x86_64.AppImage',
      },
      arch,
    );
    assert.ok(c);
    assert.equal(isNewer(c!.version, '0.7.2'), false);
  });
});
