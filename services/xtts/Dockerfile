FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 sox libsox-fmt-all git build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Pin torch+torchaudio from the same CPU wheel set; pin transformers for Coqui XTTS.
RUN pip install --no-cache-dir \
      torch==2.5.1 torchaudio==2.5.1 \
      --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --force-reinstall \
      torch==2.5.1 torchaudio==2.5.1 \
      --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir \
      'transformers==4.40.2' 'tokenizers<0.20' 'networkx>=2.5,<3.0'

COPY app.py qwen3_tts.py /app/

# Separate venv so Qwen3-TTS does not upgrade the transformers pin Coqui needs.
RUN python3 -m venv /opt/qwen3-tts \
    && /opt/qwen3-tts/bin/pip install --no-cache-dir \
      torch==2.5.1 torchaudio==2.5.1 \
      --index-url https://download.pytorch.org/whl/cpu \
    && /opt/qwen3-tts/bin/pip install --no-cache-dir 'qwen-tts' soundfile

ENV STORAGE_ROOT=/var/lib/spockify \
    QWEN3_TTS_PYTHON=/opt/qwen3-tts/bin/python \
    QWEN3_TTS_DIR=/var/lib/spockify/qwen3-tts \
    QWEN3_TTS_SCRIPT=/app/qwen3_tts.py \
    XTTS_DEVICE=cpu \
    XTTS_MODEL=tts_models/multilingual/multi-dataset/xtts_v2 \
    COQUI_TOS_AGREED=1 \
    TTS_HOME=/var/lib/spockify/xtts/models

EXPOSE 8020
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8020"]
