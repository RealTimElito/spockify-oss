"""Public /api/v1/audio/speech clone vs Edge routing."""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from open_webui.routers import audio
from open_webui.utils.auth import get_verified_user


def _user():
    return SimpleNamespace(id='user-1', role='admin')


class _Config:
    TTS_ENGINE = 'edge'
    TTS_MODEL = 'edge-tts'
    TTS_VOICE = ''
    USER_PERMISSIONS = {}


class _Resp:
    def __init__(self, status: int, body: bytes = b''):
        self.status = status
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def read(self) -> bytes:
        return self._body

    async def text(self) -> str:
        return self._body.decode('utf-8', errors='replace')


class _Session:
    """Stand-in for aiohttp.ClientSession. Set mode before the request."""

    mode = 'down'
    audio = b''

    def __init__(self, *args, **kwargs):
        del args, kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    def post(self, url, data=None):
        del url, data
        if self.mode == 'down':
            raise ConnectionError('xtts down')
        if self.mode == 'http503':
            return _Resp(503, b'warming')
        return _Resp(200, self.audio)

    def get(self, url):
        del url
        if self.mode == 'down':
            raise ConnectionError('xtts down')
        return _Resp(200, b'{"ok":true}')


class SpeechCloneRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._cache = Path(tempfile.mkdtemp(prefix='speech-xtts-'))
        self.addCleanup(lambda: shutil.rmtree(self._cache, ignore_errors=True))
        self._prev_cache = audio.SPEECH_CACHE_DIR
        audio.SPEECH_CACHE_DIR = self._cache
        self.addCleanup(lambda: setattr(audio, 'SPEECH_CACHE_DIR', self._prev_cache))

        self._env = {
            'XTTS_ENABLED': os.environ.get('XTTS_ENABLED'),
            'XTTS_URL': os.environ.get('XTTS_URL'),
        }
        os.environ['XTTS_ENABLED'] = '1'
        os.environ['XTTS_URL'] = 'http://xtts.test'
        self.addCleanup(self._restore_env)

        _Session.mode = 'down'
        _Session.audio = b''
        self._session_patch = mock.patch.object(audio.aiohttp, 'ClientSession', _Session)
        self._session_patch.start()
        self.addCleanup(self._session_patch.stop)

        app = FastAPI()
        app.include_router(audio.router, prefix='/api/v1/audio')
        app.dependency_overrides[get_verified_user] = _user
        app.state.config = _Config()
        self.client = TestClient(app)

    def _restore_env(self) -> None:
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_models_lists_edge_and_xtts(self) -> None:
        res = self.client.get('/api/v1/audio/models')
        self.assertEqual(res.status_code, 200)
        ids = {row['id'] for row in res.json()['models']}
        self.assertIn('edge-tts', ids)
        self.assertIn('xtts', ids)

    def test_stem_present_xtts_down_is_503(self) -> None:
        _Session.mode = 'down'
        edge = types.ModuleType('edge_tts')

        class _Boom:
            def __init__(self, *_args, **_kwargs):
                raise AssertionError('Edge must not run when a stem was sent')

        edge.Communicate = _Boom
        with mock.patch.dict(sys.modules, {'edge_tts': edge}):
            res = self.client.post(
                '/api/v1/audio/speech',
                data={'input': 'I can fix it!', 'language': 'en'},
                files={'speaker_wav': ('ref.wav', b'RIFF' + b'\x00' * 2000, 'audio/wav')},
            )
        self.assertEqual(res.status_code, 503)
        self.assertIn('XTTS', res.json()['detail'])

    def test_model_xtts_without_sidecar_is_503(self) -> None:
        _Session.mode = 'down'
        res = self.client.post(
            '/api/v1/audio/speech',
            json={'input': 'I can fix it!', 'model': 'xtts', 'voice': 'clone'},
        )
        self.assertEqual(res.status_code, 503)
        self.assertIn('XTTS', res.json()['detail'])

    def test_stem_absent_uses_edge(self) -> None:
        calls = {'n': 0}
        edge = types.ModuleType('edge_tts')

        class _Comm:
            def __init__(self, text, voice, rate=None, pitch=None, volume=None):
                calls['n'] += 1
                self.text = text

            async def save(self, path):
                Path(path).write_bytes(b'ID3' + b'edge-scratch')

        edge.Communicate = _Comm
        with mock.patch.dict(sys.modules, {'edge_tts': edge}):
            res = self.client.post(
                '/api/v1/audio/speech',
                json={'input': 'Hello from Edge.', 'voice': 'en-US-AvaMultilingualNeural'},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(calls['n'], 1)
        self.assertTrue(res.content.startswith(b'ID3'))
        self.assertIn('audio', res.headers['content-type'])

    def test_stem_present_proxies_xtts_audio(self) -> None:
        _Session.mode = 'ok'
        _Session.audio = b'RIFF' + b'\x00' * 128

        def _transcode(audio_data, content_type, output_path):
            del audio_data, content_type
            Path(output_path).write_bytes(b'ID3' + b'cloned-audio')
            return True

        with mock.patch.object(audio, 'transcode_audio_to_mp3', _transcode):
            res = self.client.post(
                '/api/v1/audio/speech',
                data={'input': 'I can fix it!', 'language': 'en'},
                files={'speaker_wav': ('ref.wav', b'RIFF' + b'\x00' * 2000, 'audio/wav')},
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.content.startswith(b'ID3'))
        self.assertEqual(res.headers.get('x-spockify-tts-engine'), 'xtts')
        self.assertIn('audio', res.headers['content-type'])


if __name__ == '__main__':
    unittest.main()
