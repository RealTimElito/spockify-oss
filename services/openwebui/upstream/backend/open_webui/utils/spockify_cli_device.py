"""Spockify CLI device login (link + user code) → LiteLLM virtual key.

RFC 8628–style flow for headless CLIs:
  1. CLI POST /cli/device/code → device_code + user_code + verification_uri
  2. User opens URI, signs in, enters code, confirms
  3. CLI polls /cli/device/token until access_token (LiteLLM sk-…) is ready
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import string
import time
from typing import Any, Optional

import aiohttp
from open_webui.env import REDIS_KEY_PREFIX

log = logging.getLogger(__name__)

DEVICE_TTL_SEC = 15 * 60
POLL_INTERVAL_SEC = 5
REDIS_PREFIX = f'{REDIS_KEY_PREFIX}:spockify:cli:device'
_MEMORY: dict[str, dict[str, Any]] = {}


def _now() -> float:
    return time.time()


def _user_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    # Avoid ambiguous chars
    alphabet = alphabet.replace('O', '').replace('0', '').replace('I', '').replace('1', '')
    left = ''.join(secrets.choice(alphabet) for _ in range(4))
    right = ''.join(secrets.choice(alphabet) for _ in range(4))
    return f'{left}-{right}'


def _device_code() -> str:
    return secrets.token_urlsafe(32)


def _litellm_base() -> str:
    raw = (os.environ.get('OPENAI_API_BASE_URL') or '').strip().rstrip('/')
    if raw.endswith('/v1'):
        raw = raw[:-3]
    return raw or 'http://litellm.spockify.svc.cluster.local:4000'


def _master_key() -> str:
    return (os.environ.get('OPENAI_API_KEY') or '').strip()


async def _store_set(redis: Any, key: str, payload: dict[str, Any], ttl: int) -> None:
    blob = json.dumps(payload)
    if redis is not None:
        try:
            await redis.set(f'{REDIS_PREFIX}:{key}', blob, ex=ttl)
            return
        except Exception as exc:  # noqa: BLE001
            log.warning('CLI device redis set failed: %s', exc)
    _MEMORY[key] = {'expires': _now() + ttl, 'payload': payload}


async def _store_get(redis: Any, key: str) -> Optional[dict[str, Any]]:
    if redis is not None:
        try:
            raw = await redis.get(f'{REDIS_PREFIX}:{key}')
            if raw:
                if isinstance(raw, bytes):
                    raw = raw.decode('utf-8')
                return json.loads(raw)
        except Exception as exc:  # noqa: BLE001
            log.warning('CLI device redis get failed: %s', exc)
    row = _MEMORY.get(key)
    if not row:
        return None
    if row['expires'] < _now():
        _MEMORY.pop(key, None)
        return None
    return row['payload']


async def _store_delete(redis: Any, key: str) -> None:
    if redis is not None:
        try:
            await redis.delete(f'{REDIS_PREFIX}:{key}')
        except Exception as exc:  # noqa: BLE001
            log.warning('CLI device redis delete failed: %s', exc)
    _MEMORY.pop(key, None)


async def create_device_session(
    redis: Any,
    *,
    public_base: str,
) -> dict[str, Any]:
    device = _device_code()
    user = _user_code()
    # Index by both codes
    payload = {
        'device_code': device,
        'user_code': user,
        'status': 'pending',  # pending | approved | denied | consumed
        'created_at': _now(),
        'user_id': None,
        'user_email': None,
        'user_name': None,
        'api_key': None,
    }
    await _store_set(redis, f'device:{device}', payload, DEVICE_TTL_SEC)
    await _store_set(
        redis,
        f'user:{user}',
        {'device_code': device},
        DEVICE_TTL_SEC,
    )
    base = public_base.rstrip('/')
    return {
        'device_code': device,
        'user_code': user,
        'verification_uri': f'{base}/api/v1/spockify/cli/activate',
        'verification_uri_complete': (
            f'{base}/api/v1/spockify/cli/activate?user_code={user}'
        ),
        'expires_in': DEVICE_TTL_SEC,
        'interval': POLL_INTERVAL_SEC,
    }


async def lookup_by_user_code(redis: Any, user_code: str) -> Optional[dict[str, Any]]:
    code = (user_code or '').strip().upper()
    if not code:
        return None
    idx = await _store_get(redis, f'user:{code}')
    if not idx:
        return None
    device = idx.get('device_code')
    if not device:
        return None
    return await _store_get(redis, f'device:{device}')


async def approve_device(
    redis: Any,
    *,
    user_code: str,
    user_id: str,
    user_email: str,
    user_name: str,
) -> dict[str, Any]:
    session = await lookup_by_user_code(redis, user_code)
    if not session:
        raise ValueError('Invalid or expired code')
    if session.get('status') not in ('pending',):
        raise ValueError(f"Code already {session.get('status')}")

    api_key = await mint_litellm_virtual_key(
        alias=f'cli:{user_email or user_id}',
        user_id=user_id,
        email=user_email,
    )
    session['status'] = 'approved'
    session['user_id'] = user_id
    session['user_email'] = user_email
    session['user_name'] = user_name
    session['api_key'] = api_key
    device = session['device_code']
    await _store_set(redis, f'device:{device}', session, DEVICE_TTL_SEC)
    return {
        'ok': True,
        'user_code': session['user_code'],
        'user_email': user_email,
    }


async def deny_device(redis: Any, user_code: str) -> dict[str, Any]:
    session = await lookup_by_user_code(redis, user_code)
    if not session:
        raise ValueError('Invalid or expired code')
    session['status'] = 'denied'
    device = session['device_code']
    await _store_set(redis, f'device:{device}', session, DEVICE_TTL_SEC)
    return {'ok': True}


async def poll_token(redis: Any, device_code: str) -> dict[str, Any]:
    session = await _store_get(redis, f'device:{(device_code or "").strip()}')
    if not session:
        return {'error': 'expired_token', 'error_description': 'Invalid or expired device code'}
    status = session.get('status')
    if status == 'pending':
        return {'error': 'authorization_pending'}
    if status == 'denied':
        await _store_delete(redis, f'device:{device_code}')
        return {'error': 'access_denied'}
    if status == 'consumed':
        return {'error': 'expired_token', 'error_description': 'Code already used'}
    if status == 'approved' and session.get('api_key'):
        key = session['api_key']
        session['status'] = 'consumed'
        session['api_key'] = None
        await _store_set(redis, f'device:{device_code}', session, 60)
        return {
            'access_token': key,
            'token_type': 'bearer',
            'expires_in': None,
            'user': {
                'id': session.get('user_id'),
                'email': session.get('user_email'),
                'name': session.get('user_name'),
            },
        }
    return {'error': 'authorization_pending'}


async def mint_litellm_virtual_key(
    *,
    alias: str,
    user_id: str,
    email: str,
) -> str:
    master = _master_key()
    if not master:
        raise RuntimeError('OPENAI_API_KEY (LiteLLM master) not configured')
    url = f'{_litellm_base()}/key/generate'
    body = {
        'key_alias': alias[:100],
        'user_id': user_id,
        'metadata': {
            'source': 'spockify-cli-device',
            'email': email,
        },
        'duration': '90d',
    }
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            url,
            json=body,
            headers={
                'Authorization': f'Bearer {master}',
                'Content-Type': 'application/json',
            },
        ) as resp:
            text = await resp.text()
            if resp.status >= 400:
                log.error('LiteLLM key/generate failed %s: %s', resp.status, text[:400])
                raise RuntimeError(f'Failed to mint API key ({resp.status})')
            try:
                data = json.loads(text)
            except json.JSONDecodeError as exc:
                raise RuntimeError('Invalid key/generate response') from exc
    # LiteLLM shapes vary: {key}, {token}, {info: {key}}
    key = (
        data.get('key')
        or data.get('token')
        or (data.get('info') or {}).get('key')
        or (data.get('data') or {}).get('key')
    )
    if not key or not isinstance(key, str):
        log.error('LiteLLM key/generate missing key field: %s', text[:400])
        raise RuntimeError('LiteLLM did not return a key')
    return key.strip()


ACTIVATE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spockify CLI — Activate</title>
  <style>
    :root { color-scheme: light dark; --fg: #e8eaed; --muted: #9aa0a6; --bg: #0f1115; --card: #1a1d24; --accent: #6ee7b7; --danger: #f87171; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, sans-serif;
      background: radial-gradient(1200px 600px at 20% -10%, #1e3a2f 0%, transparent 50%), var(--bg); color: var(--fg);
      display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { width: 100%; max-width: 420px; background: var(--card); border: 1px solid #2a2f3a; border-radius: 16px; padding: 28px; }
    h1 { font-size: 1.25rem; margin: 0 0 6px; }
    p { color: var(--muted); margin: 0 0 18px; line-height: 1.45; font-size: 0.95rem; }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 6px; }
    input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #3a4150; background: #0f1115; color: var(--fg); font-size: 1.15rem; letter-spacing: 0.12em; text-transform: uppercase; }
    .row { display: flex; gap: 10px; margin-top: 16px; }
    button { flex: 1; padding: 12px 14px; border: 0; border-radius: 10px; font-weight: 600; cursor: pointer; }
    .ok { background: var(--accent); color: #062016; }
    .no { background: #2a2f3a; color: var(--fg); }
    .msg { margin-top: 14px; font-size: 0.9rem; min-height: 1.2em; }
    .err { color: var(--danger); }
    .okmsg { color: var(--accent); }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Activate Spockify CLI</h1>
    <p>Enter the code shown in your terminal. You must be signed in to Spockify.</p>
    <label for="code">Device code</label>
    <input id="code" maxlength="9" placeholder="ABCD-EFGH" autocomplete="one-time-code" />
    <div class="row">
      <button class="ok" id="approve">Approve</button>
      <button class="no" id="deny">Deny</button>
    </div>
    <div class="msg" id="msg"></div>
    <p style="margin-top:18px;font-size:0.8rem">Not signed in? <a href="/auth">Sign in</a>, then return here.</p>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    const input = document.getElementById('code');
    const msg = document.getElementById('msg');
    if (params.get('user_code')) input.value = params.get('user_code');
    async function post(path, body) {
      const token = localStorage.token;
      if (!token) throw new Error('Not signed in — open Spockify, sign in, then reload this page.');
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      const detail = data.detail;
      const errMsg = (typeof detail === 'string' ? detail : null)
        || detail?.error_description || detail?.error
        || data.error_description || data.error || res.statusText;
      if (!res.ok) throw new Error(errMsg);
      return data;
    }
    document.getElementById('approve').onclick = async () => {
      msg.className = 'msg'; msg.textContent = 'Approving…';
      try {
        await post('/api/v1/spockify/cli/device/approve', { user_code: input.value.trim() });
        msg.className = 'msg okmsg';
        msg.textContent = 'Approved. Return to your terminal — login should finish shortly.';
      } catch (e) {
        msg.className = 'msg err'; msg.textContent = e.message || String(e);
      }
    };
    document.getElementById('deny').onclick = async () => {
      msg.className = 'msg'; msg.textContent = 'Denying…';
      try {
        await post('/api/v1/spockify/cli/device/deny', { user_code: input.value.trim() });
        msg.className = 'msg'; msg.textContent = 'Denied.';
      } catch (e) {
        msg.className = 'msg err'; msg.textContent = e.message || String(e);
      }
    };
  </script>
</body>
</html>
"""
