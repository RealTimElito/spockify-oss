"""One-shot Qwen3-TTS CustomVoice synthesis. Run with the sidecar venv python.

Stdin is unused. Args: text, speaker, language, out_wav, model_dir.
Writes a WAV and exits. Kept out of the Coqui interpreter (transformers pin).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def max_new_tokens_for(text: str) -> int:
    """Bound codec steps so a short line finishes on CPU.

    The library default is 2048. That does not return before the router
    client times out, and several copies of it OOM'd the 16Gi sidecar.
    ~12 codec frames/sec and ~15 spoken characters/sec, plus a stop pad.
    """
    chars = max(1, len((text or "").strip()))
    estimate = int(chars / 15 * 12) + 24
    return min(256, max(48, estimate))


def main() -> int:
    if len(sys.argv) < 6:
        print("usage: qwen3_tts.py TEXT SPEAKER LANGUAGE OUT_WAV MODEL_DIR", file=sys.stderr)
        return 2
    text, speaker, language, out_wav, model_dir = sys.argv[1:6]
    threads = os.environ.get("QWEN3_TTS_THREADS", "4")
    os.environ.setdefault("OMP_NUM_THREADS", threads)
    os.environ.setdefault("MKL_NUM_THREADS", threads)
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    try:
        torch.set_num_threads(max(1, int(threads)))
    except ValueError:
        torch.set_num_threads(4)
    lang = {
        "en": "English",
        "english": "English",
        "zh": "Chinese",
        "chinese": "Chinese",
    }.get((language or "en").strip().lower(), "English")
    model = Qwen3TTSModel.from_pretrained(
        model_dir,
        device_map="cpu",
        dtype=torch.float32,
        local_files_only=True,
    )
    wavs, rate = model.generate_custom_voice(
        text=text,
        language=lang,
        speaker=speaker or "Ryan",
        max_new_tokens=max_new_tokens_for(text),
    )
    audio = wavs[0]
    Path(out_wav).parent.mkdir(parents=True, exist_ok=True)
    sf.write(out_wav, audio, int(rate))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
