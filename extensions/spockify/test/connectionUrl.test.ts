import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCOUNT_API_KEY_HELP,
  DEFAULT_SELF_HOST_BASE,
  DEPRECATED_TWIN_HOST,
  SELF_HOST_LAN_HINT,
  SpockifyHttpClient,
  isDeprecatedTwinHost,
  normalizeProductBaseUrl,
  selfHostPlaceholder,
  v1ClientUrl,
} from '@spockify/ide-client';

describe('IDE connection URLs', () => {
  it('does not default self-host to spark-f1f9', () => {
    assert.equal(DEFAULT_SELF_HOST_BASE, 'http://127.0.0.1:3080');
    assert.equal(selfHostPlaceholder('http://spark-f1f9.local:30080'), DEFAULT_SELF_HOST_BASE);
    assert.equal(isDeprecatedTwinHost(DEFAULT_SELF_HOST_BASE), false);
    assert.ok(!DEFAULT_SELF_HOST_BASE.includes(DEPRECATED_TWIN_HOST));
    assert.ok(!SELF_HOST_LAN_HINT.includes(DEPRECATED_TWIN_HOST));
  });

  it('does not double /v1 on the OpenAI-compat client URL', () => {
    assert.equal(
      normalizeProductBaseUrl('https://spockify.eu/v1'),
      'https://spockify.eu',
    );
    assert.equal(v1ClientUrl('https://spockify.eu/v1/'), 'https://spockify.eu/v1');
    const http = new SpockifyHttpClient({ baseUrl: 'http://127.0.0.1:3080/v1' });
    assert.equal(http.baseUrl, 'http://127.0.0.1:3080');
    assert.equal(http.v1Base, 'http://127.0.0.1:3080/v1');
  });

  it('rewrites the retired twin hostname', () => {
    assert.equal(
      normalizeProductBaseUrl('http://spark-f1f9.local:30080'),
      'http://sparky.local:30080',
    );
  });

  it('does not send people to LiteLLM /ui/ for user keys', () => {
    assert.match(ACCOUNT_API_KEY_HELP, /Settings → Account → API key/);
    assert.match(ACCOUNT_API_KEY_HELP, /not the LiteLLM \/ui\//);
  });
});
