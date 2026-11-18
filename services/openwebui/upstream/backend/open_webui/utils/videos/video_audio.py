"""Post-hoc TTS narration for silent ComfyUI / LTX mp4 clips.

LTX T2V/I2V outputs video-only. After download we optionally synthesize brief
edge-tts audio from a *spoken script* derived from the user prompt (Sofie /
Ava via the same voice picker as ``/audio/speech``) and
``ffmpeg -c:v copy -c:a aac`` mux before chat upload.

Failures never fail the video path — callers keep the silent mp4 and log a
warning. Clips are short (≈1–10s); narration is truncated and audio is
trimmed/padded to the video duration.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import tempfile
from pathlib import Path

from open_webui.env import ENABLE_VIDEO_AUDIO

log = logging.getLogger(__name__)

# Rough speaking rate for edge-tts at ~-3% rate (words per second).
_WORDS_PER_SEC = 2.4
_MIN_WORDS = 4
# Cap covers ~10s chips (241 frames @ 24fps ≈ 10s × 2.4 wps).
_MAX_WORDS = 24

_SENTENCE_SPLIT = re.compile(r'(?<=[.!?])\s+')

# Duration chips / UI noise sometimes pasted into the prompt text.
_LENGTH_NOISE_RE = re.compile(
    r'(?ix)\s*(?:'
    r'[\(\[]\s*(?:short|default|long|~?2\.7s|10s?|1s|2s|3s|4s)\s*[\)\]]|'
    r'(?:video\s+)?(?:length|duration)\s*[:=]?\s*(?:short|default|long|~?2\.7s|10s?)|'
    r'\b(?:short|default|long|10s?)\s+(?:clip|video|length)\b'
    r')\s*'
)

# Explicit TTS script: "say …", "with narration: …", etc.
_NARRATION_DIRECTIVE_RE = re.compile(
    r'(?ix)'
    r'(?:'
    # Mid-prompt: "… with narration: Hello" / "voiceover: …"
    r'\b(?:with\s+)?(?:narration|voice[\s\-]?over|voiceover|'
    r'spoken\s+(?:line|text)|audio(?:\s+script)?)\s*[:=]\s*'
    r'|'
    # Start / new clause: "say: …" / "Please speak …"
    r'(?:^|[.;!?]\s*|\n\s*)(?:please\s+)?'
    r'(?:say|speak|narrate|read(?:\s+aloud)?)\s*[:=]?\s*'
    r')'
    r'["“‘\']?(?P<script>.+?)["”’\']?\s*$'
)

# Scene subject that embeds dialogue: … saying "hello".
_SAYING_RE = re.compile(
    r'(?ix)\b(?:saying|that\s+says|who\s+says|and\s+says)\s+'
    r'["“‘\']?(?P<script>[^"”’\']+?)["”’\']?\s*[.!]?\s*$'
)

# Whole prompt is just a quoted line.
_WHOLE_QUOTE_RE = re.compile(
    r'(?xs)^\s*["“‘\'](?P<script>[^"”’\']{2,160})["”’\']\s*[.!]?\s*$'
)

# I2V / empty subjects that should stay silent rather than be read aloud.
_GENERIC_SUBJECT_RE = re.compile(
    r'(?i)^(?:'
    r'(?:please\s+)?animate\s+(?:me\s+|us\s+)?(?:a|an|the|this|that)|'
    r'this|that|it|'
    r'(?:this|that|the)\s+(?:image|photo|picture|drawing|pic)|'
    r'(?:image|photo|picture|drawing|pic)'
    r')\s*$'
)

# Leftover instruction wrappers if extract_video_prompt was skipped.
_INTENT_LEFTOVER_RE = re.compile(
    r'(?ix)^\s*(?:please\s+)?'
    r'(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?'
    r'(?:'
    r'(?:generate|create|make|render)\s+(?:me\s+|us\s+)?'
    r'(?:an?\s+)?(?:video|clip|animation)\s+(?:of\s+|showing\s+|with\s+|about\s+)?'
    r'|'
    r'animate\s+(?:me\s+|us\s+)?(?:a|an|the|this|that)\s+'
    r'|'
    r'text[\s\-]?to[\s\-]?video\s+(?:of\s+|showing\s+|with\s+|about\s+)?'
    r'|'
    r'ltx[\s\-]?v(?:ideo)?\s*(?::\s*|\s+of\s+)?'
    r')'
)


def video_audio_enabled() -> bool:
    """Feature flag; default ON so generated clips get narration unless opted out."""
    return bool(ENABLE_VIDEO_AUDIO)


def _word_budget(duration_seconds: float) -> int:
    return int(max(_MIN_WORDS, min(_MAX_WORDS, duration_seconds * _WORDS_PER_SEC)))


def _trim_words(text: str, duration_seconds: float) -> str:
    cleaned = re.sub(r'\s+', ' ', (text or '').strip())
    if not cleaned:
        return ''
    first = _SENTENCE_SPLIT.split(cleaned, maxsplit=1)[0].strip()
    words = first.split(' ') if first else cleaned.split(' ')
    budget = _word_budget(duration_seconds)
    if len(words) > budget:
        words = words[:budget]
    return ' '.join(words).strip(' ,;:-')


def _strip_length_noise(text: str) -> str:
    return _LENGTH_NOISE_RE.sub(' ', text or '').strip()


def _clean_visual_subject(text: str) -> str:
    """Strip video-intent boilerplate and chip noise → scene subject."""
    cleaned = _strip_length_noise(re.sub(r'\s+', ' ', (text or '').strip()))
    if not cleaned:
        return ''

    try:
        from open_webui.utils.video_intent import extract_video_prompt

        subject = (extract_video_prompt(cleaned) or cleaned).strip()
    except Exception:  # noqa: BLE001
        subject = cleaned

    # Second pass if extract left a wrapper (or extract was a no-op).
    subject = _INTENT_LEFTOVER_RE.sub('', subject).strip()
    subject = re.sub(r'(?i)^(?:of|showing|with|about)\s+', '', subject).strip()
    subject = subject.rstrip('.!?').strip()
    if _GENERIC_SUBJECT_RE.match(subject):
        return ''
    return subject


def _explicit_speech_script(text: str) -> str | None:
    """Prefer an explicit spoken line over describing the visual."""
    cleaned = _strip_length_noise(re.sub(r'\s+', ' ', (text or '').strip()))
    if not cleaned:
        return None

    for pattern in (_NARRATION_DIRECTIVE_RE, _SAYING_RE, _WHOLE_QUOTE_RE):
        match = pattern.search(cleaned)
        if not match:
            continue
        script = (match.group('script') or '').strip().strip('\'"“”‘’')
        script = script.rstrip('.,;:').strip()
        if len(script) >= 2:
            return script
    return None


def _natural_caption(subject: str) -> str:
    """Short scene line suitable for TTS (not instruction-to-the-model)."""
    s = (subject or '').strip().rstrip('.!?')
    if not s:
        return ''
    # Avoid reading leftover model-facing camera jargon alone.
    if re.fullmatch(
        r'(?i)natural\s+motion(?:\s*,\s*subtle\s+camera\s+movement)?',
        s,
    ):
        return ''
    if s[0].islower():
        s = s[0].upper() + s[1:]
    return s


def spoken_narration(text: str, duration_seconds: float) -> str:
    """Build a short TTS script from a user/video prompt.

    Precedence:
    1. Explicit say / narration / quoted speech
    2. Natural caption from the visual subject (boilerplate stripped)
    """
    spoken = _explicit_speech_script(text)
    if spoken:
        return _trim_words(spoken, duration_seconds)

    subject = _clean_visual_subject(text)
    caption = _natural_caption(subject)
    return _trim_words(caption, duration_seconds)


def brief_narration(text: str, duration_seconds: float) -> str:
    """Backward-compatible alias — now builds a spoken script, not raw trim."""
    return spoken_narration(text, duration_seconds)


async def _synthesize_edge_tts(text: str) -> bytes | None:
    """Return mp3 bytes via edge-tts, or None on failure."""
    try:
        import edge_tts
    except ImportError:
        log.warning('video audio: edge-tts not installed; keeping silent mp4')
        return None

    try:
        # Reuse the same Softie/Ava language picker as /audio/speech.
        from open_webui.routers.audio import (
            _EDGE_DEFAULT_PITCH,
            _EDGE_DEFAULT_RATE,
            _EDGE_DEFAULT_VOLUME,
            _resolve_edge_voice,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning('video audio: could not import edge voice helpers: %s', exc)
        return None

    voice = _resolve_edge_voice(None, text)
    rate = _EDGE_DEFAULT_RATE
    pitch = _EDGE_DEFAULT_PITCH
    volume = _EDGE_DEFAULT_VOLUME

    try:
        communicate = edge_tts.Communicate(
            text, voice, rate=rate, pitch=pitch, volume=volume
        )
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk.get('type') == 'audio' and chunk.get('data'):
                chunks.append(chunk['data'])
        audio = b''.join(chunks)
        if not audio or len(audio) < 64:
            log.warning('video audio: edge-tts returned empty audio')
            return None
        log.info(
            'video audio: edge-tts voice=%s rate=%s bytes=%s text=%r',
            voice,
            rate,
            len(audio),
            text[:80],
        )
        return audio
    except Exception as exc:  # noqa: BLE001
        log.warning('video audio: edge-tts failed: %s', exc)
        return None


def _ffmpeg_mux(video_bytes: bytes, audio_bytes: bytes, duration_seconds: float) -> bytes | None:
    """Mux silent mp4 + mp3 → mp4 with AAC; trim/pad audio to video length."""
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        log.warning('video audio: ffmpeg not on PATH; keeping silent mp4')
        return None

    dur = max(0.25, float(duration_seconds))
    with tempfile.TemporaryDirectory(prefix='spockify-video-audio-') as tmp:
        tmp_path = Path(tmp)
        video_path = tmp_path / 'silent.mp4'
        audio_path = tmp_path / 'narration.mp3'
        out_path = tmp_path / 'muxed.mp4'
        video_path.write_bytes(video_bytes)
        audio_path.write_bytes(audio_bytes)

        # Pad short TTS with silence, trim long TTS; keep video bitstream.
        # apad + atrim + -t keeps A/V length matched without re-encoding video.
        cmd = [
            ffmpeg,
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            str(video_path),
            '-i',
            str(audio_path),
            '-filter_complex',
            f'[1:a]apad,atrim=0:{dur:.3f},asetpts=PTS-STARTPTS[a]',
            '-map',
            '0:v:0',
            '-map',
            '[a]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-t',
            f'{dur:.3f}',
            '-movflags',
            '+faststart',
            str(out_path),
        ]
        try:
            import subprocess

            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=60,
                check=False,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning('video audio: ffmpeg mux failed: %s', exc)
            return None

        if proc.returncode != 0 or not out_path.is_file() or out_path.stat().st_size < 100:
            err = (proc.stderr or b'').decode('utf-8', errors='replace')[:300]
            log.warning(
                'video audio: ffmpeg mux exit=%s stderr=%s',
                proc.returncode,
                err or '(empty)',
            )
            return None
        return out_path.read_bytes()


async def maybe_add_video_narration(
    video_data: bytes,
    *,
    narration: str,
    duration_seconds: float,
) -> tuple[bytes, bool]:
    """Best-effort TTS + mux. Returns (bytes, audio_added). Never raises."""
    if not video_audio_enabled():
        return video_data, False
    if not video_data:
        return video_data, False

    text = spoken_narration(narration, duration_seconds)
    if not text:
        log.info('video audio: empty narration after trim; keeping silent mp4')
        return video_data, False

    try:
        audio = await _synthesize_edge_tts(text)
        if not audio:
            return video_data, False

        muxed = await asyncio.to_thread(
            _ffmpeg_mux, video_data, audio, duration_seconds
        )
        if not muxed:
            return video_data, False
        return muxed, True
    except Exception as exc:  # noqa: BLE001
        log.warning('video audio: unexpected failure, keeping silent mp4: %s', exc)
        return video_data, False
