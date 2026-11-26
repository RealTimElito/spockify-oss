"""Patch LatentSync for aarch64 Spark (no decord wheel; local VAE path)."""

from __future__ import annotations

import re
from pathlib import Path

UTIL = Path("/opt/LatentSync/latentsync/utils/util.py")
INFERENCE = Path("/opt/LatentSync/scripts/inference.py")

DECORD_IMPORT = "from decord import AudioReader, VideoReader\n"
DECORD_OPTIONAL = (
    "try:\n"
    "    from decord import AudioReader, VideoReader  # type: ignore\n"
    "    _HAS_DECORD = True\n"
    "except Exception:  # aarch64 / no wheel\n"
    "    AudioReader = None  # type: ignore\n"
    "    VideoReader = None  # type: ignore\n"
    "    _HAS_DECORD = False\n"
)

READ_AUDIO = '''def read_audio(audio_path: str, audio_sample_rate: int = 16000):
    if audio_path is None:
        raise ValueError("Audio path is required.")
    if _HAS_DECORD:
        ar = AudioReader(audio_path, sample_rate=audio_sample_rate, mono=True)
        audio_samples = torch.from_numpy(ar[:].asnumpy())
        audio_samples = audio_samples.squeeze(0)
        return audio_samples
    import librosa

    samples, _ = librosa.load(audio_path, sr=audio_sample_rate, mono=True)
    return torch.from_numpy(samples.astype("float32"))
'''


def main() -> None:
    text = UTIL.read_text(encoding="utf-8")
    if DECORD_IMPORT in text:
        text = text.replace(DECORD_IMPORT, DECORD_OPTIONAL)
    text = text.replace(
        "if use_decord:\n        return read_video_decord(target_video_path)",
        "if use_decord and _HAS_DECORD:\n        return read_video_decord(target_video_path)",
    )
    text = re.sub(
        r"def read_audio\(audio_path: str, audio_sample_rate: int = 16000\):\n(?:.*\n){0,16}?    return audio_samples\n",
        READ_AUDIO,
        text,
        count=1,
    )
    UTIL.write_text(text, encoding="utf-8")

    inf = INFERENCE.read_text(encoding="utf-8")
    inf = inf.replace(
        'AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse"',
        'AutoencoderKL.from_pretrained(os.environ.get("SPOCKIFY_LATENTSYNC_VAE", '
        '"/opt/ComfyUI/models/loras/_oj/latentsync/sd-vae-ft-mse")',
    )
    INFERENCE.write_text(inf, encoding="utf-8")
    print("PATCH_OK")


if __name__ == "__main__":
    main()
