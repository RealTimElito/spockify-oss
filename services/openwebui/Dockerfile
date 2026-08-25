# syntax=docker/dockerfile:1
# Spockify OpenWebUI — vendored upstream @ v0.9.6 with Spockify edits in-tree.
ARG BUILD_HASH=spockify-dev

######## Frontend build ########
FROM --platform=$BUILDPLATFORM node:22-alpine3.20 AS frontend-build
ARG BUILD_HASH

WORKDIR /src
COPY upstream/ upstream/

WORKDIR /src/upstream
RUN npm ci --force
ENV APP_BUILD_HASH=${BUILD_HASH}
# Vite/Svelte build needs headroom on aarch64 hosts (default ~2GB OOMs).
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN npm run build

# Spockify branding (generated before docker build — see scripts/build-openwebui.sh)
COPY branding/ /branding/
RUN cp -f /branding/* /src/upstream/build/static/ && \
    cp -f /branding/favicon.ico /src/upstream/build/favicon.ico && \
    cp -f /branding/favicon.png /src/upstream/build/favicon.png

######## Backend (matches upstream slim CPU image) ########
FROM python:3.11-slim-bookworm AS runtime
ARG BUILD_HASH

ENV PYTHONUNBUFFERED=1 \
    ENV=prod \
    PORT=8080 \
    DOCKER=true \
    WEBUI_BUILD_VERSION=${BUILD_HASH} \
    SCARF_NO_ANALYTICS=true \
    DO_NOT_TRACK=true \
    ANONYMIZED_TELEMETRY=false \
    OLLAMA_BASE_URL="/ollama" \
    OPENAI_API_BASE_URL="" \
    OPENAI_API_KEY="" \
    WEBUI_SECRET_KEY="" \
    WHISPER_MODEL="base" \
    WHISPER_MODEL_DIR="/app/backend/data/cache/whisper/models" \
    RAG_EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2" \
    AUXILIARY_EMBEDDING_MODEL="TaylorAI/bge-micro-v2" \
    SENTENCE_TRANSFORMERS_HOME="/app/backend/data/cache/embedding/models" \
    TIKTOKEN_ENCODING_NAME="cl100k_base" \
    TIKTOKEN_CACHE_DIR="/app/backend/data/cache/tiktoken" \
    HF_HOME="/app/backend/data/cache/embedding/models"

WORKDIR /app/backend

RUN mkdir -p /root/.cache/chroma && \
    echo -n 00000000-0000-0000-0000-000000000000 > /root/.cache/chroma/telemetry_user_id

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git build-essential pandoc gcc netcat-openbsd curl jq \
    libmariadb-dev python3-dev ffmpeg libsm6 libxext6 zstd && \
    rm -rf /var/lib/apt/lists/*

COPY --from=frontend-build /src/upstream/backend/requirements.txt ./requirements.txt
ENV UV_LINK_MODE=copy
RUN pip3 install --no-cache-dir uv && \
    pip3 install 'torch<=2.9.1' torchvision torchaudio \
      --index-url https://download.pytorch.org/whl/cpu --no-cache-dir && \
    uv pip install --system -r requirements.txt --no-cache-dir && \
    python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer(os.environ['RAG_EMBEDDING_MODEL'], device='cpu')" && \
    python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer(os.environ['AUXILIARY_EMBEDDING_MODEL'], device='cpu')" && \
    python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['WHISPER_MODEL'], device='cpu', compute_type='int8', download_root=os.environ['WHISPER_MODEL_DIR'])" && \
    python -c "import os; import tiktoken; tiktoken.get_encoding(os.environ['TIKTOKEN_ENCODING_NAME'])" && \
    python -c "import nltk; nltk.download('punkt_tab')" && \
    mkdir -p /app/backend/data

# Spockify: Microsoft Edge neural TTS (no API key) for Swedish/English fallback
RUN pip3 install --no-cache-dir 'edge-tts>=6.1.0' && python -c "import edge_tts"

COPY --from=frontend-build /src/upstream/build /app/build
COPY --from=frontend-build /src/upstream/CHANGELOG.md /app/CHANGELOG.md
COPY --from=frontend-build /src/upstream/package.json /app/package.json
COPY --from=frontend-build /src/upstream/backend .

EXPOSE 8080
HEALTHCHECK CMD curl --silent --fail http://localhost:${PORT:-8080}/health | jq -ne 'input.status == true' || exit 1
CMD ["bash", "start.sh"]
