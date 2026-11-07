import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCOUNT_API_KEY_HELP,
  CURRENT_TWIN_HOST,
  DEFAULT_CLOUD_BASE,
  DEFAULT_SELF_HOST_BASE,
  DEPRECATED_TWIN_HOST,
  SELF_HOST_LAN_HINT,
  TAB_FIM_SELF_HOST_HELP,
  connectionHostLabel,
  isCloudHost,
  isDeprecatedTwinHost,
  looksLikeRouterPort,
  normalizeProductBaseUrl,
  resolveConnectBaseUrl,
  selfHostPlaceholder,
  stripV1Suffix,
  v1ClientUrl,
} from '../src/connection';
import { SpockifyHttpClient } from '../src/http';

describe('connection URL normalization', () => {
  it('defaults to local compose, not a hosted cloud root', () => {
    assert.equal(normalizeProductBaseUrl(undefined), DEFAULT_SELF_HOST_BASE);
    assert.equal(normalizeProductBaseUrl(''), DEFAULT_SELF_HOST_BASE);
    assert.equal(DEFAULT_SELF_HOST_BASE, 'http://127.0.0.1:3080');
    assert.ok(!DEFAULT_SELF_HOST_BASE.endsWith('/v1'));
  });

  it('strips trailing slashes and a /v1 suffix so clients do not double /v1', () => {
    assert.equal(stripV1Suffix('https://spockify.eu/v1/'), 'https://spockify.eu');
    assert.equal(
      normalizeProductBaseUrl('https://spockify.eu/v1'),
      'https://spockify.eu',
    );
    assert.equal(
      normalizeProductBaseUrl('http://127.0.0.1:3080/v1/'),
      'http://127.0.0.1:3080',
    );
    const client = new SpockifyHttpClient({
      baseUrl: 'http://127.0.0.1:3080/v1',
    });
    assert.equal(client.baseUrl, 'http://127.0.0.1:3080');
    assert.equal(client.v1Base, 'http://127.0.0.1:3080/v1');
    assert.equal(v1ClientUrl('http://127.0.0.1:3080/v1/'), 'http://127.0.0.1:3080/v1');
  });

  it('self-host default is compose OWUI, never spark-f1f9', () => {
    assert.equal(DEFAULT_SELF_HOST_BASE, 'http://127.0.0.1:3080');
    assert.equal(selfHostPlaceholder(), DEFAULT_SELF_HOST_BASE);
    assert.equal(selfHostPlaceholder('https://spockify.eu'), DEFAULT_SELF_HOST_BASE);
    assert.equal(
      selfHostPlaceholder('http://spark-f1f9.local:30080'),
      DEFAULT_SELF_HOST_BASE,
    );
    assert.ok(!DEFAULT_SELF_HOST_BASE.includes(DEPRECATED_TWIN_HOST));
    assert.ok(!selfHostPlaceholder().includes(DEPRECATED_TWIN_HOST));
    assert.ok(!SELF_HOST_LAN_HINT.includes(DEPRECATED_TWIN_HOST));
  });

  it('rejects spark-f1f9 as a stored default by rewriting to sparky.local', () => {
    assert.equal(isDeprecatedTwinHost('http://spark-f1f9.local:30080'), true);
    assert.equal(isDeprecatedTwinHost('http://sparky.local:30080'), false);
    assert.equal(
      normalizeProductBaseUrl('http://spark-f1f9.local:30080'),
      `http://${CURRENT_TWIN_HOST}:30080`,
    );
  });

  it('keeps a real self-host URL as the placeholder', () => {
    assert.equal(
      selfHostPlaceholder('http://10.0.0.10:30080'),
      'http://10.0.0.10:30080',
    );
  });

  it('adds http:// when the user omits a scheme', () => {
    assert.equal(
      normalizeProductBaseUrl('127.0.0.1:3080'),
      'http://127.0.0.1:3080',
    );
  });

  it('flags router :4100 so Tab/FIM stays on OWUI', () => {
    assert.equal(looksLikeRouterPort('http://127.0.0.1:4100'), true);
    assert.equal(looksLikeRouterPort('http://127.0.0.1:3080'), false);
    assert.match(TAB_FIM_SELF_HOST_HELP, /:3080/);
    assert.match(TAB_FIM_SELF_HOST_HELP, /:4100/);
  });

  it('self-host connect bases; empty is not treated as cloud', () => {
    assert.equal(isCloudHost(''), false);
    assert.equal(isCloudHost(undefined), false);
    assert.equal(isCloudHost('https://spockify.eu'), true);
    assert.equal(isCloudHost('http://127.0.0.1:3080'), false);
    assert.equal(DEFAULT_CLOUD_BASE, 'https://spockify.eu');
    assert.equal(
      resolveConnectBaseUrl({
        kind: 'selfhost',
        baseUrl: 'http://127.0.0.1:3080/v1',
      }),
      'http://127.0.0.1:3080',
    );
    assert.equal(
      resolveConnectBaseUrl({ kind: 'key' }),
      DEFAULT_SELF_HOST_BASE,
    );
    assert.equal(
      connectionHostLabel('http://127.0.0.1:3080/v1'),
      '127.0.0.1:3080',
    );
  });

  it('points API keys at Account, not LiteLLM /ui/', () => {
    assert.match(ACCOUNT_API_KEY_HELP, /Settings → Account → API key/);
    assert.match(ACCOUNT_API_KEY_HELP, /\/ui\//);
    assert.ok(!ACCOUNT_API_KEY_HELP.includes('Create a key at https://spockify.eu/ui/'));
  });
});
