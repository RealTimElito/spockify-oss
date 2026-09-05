# syntax=docker/dockerfile:1
# Spockify OpenWebUI — vendored upstream @ v0.9.6 with Spockify edits in-tree.
ARG BUILD_HASH=spockify-dev
# CI/downloadable builds can skip embedding Whisper/embed models (first run downloads).
ARG PRELOAD_MODELS=true

######## Branding (generated, or prebuilt PNGs in branding/) ########
FROM python:3.12-slim-bookworm AS branding
WORKDIR /work
RUN apt-get update && \
    apt-get install -y --no-install-recommends fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --no-cache-dir pillow
COPY generate_branding.py ./
COPY branding/ ./prebuilt/
RUN python3 generate_branding.py --prebuilt /work/prebuilt --out /out

######## Frontend build ########
# Debian, not Alpine: sass-embedded / rollup native bindings fail on musl
# (common Fedora/Podman "npm run build did not complete successfully").
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend-build
ARG BUILD_HASH
ARG NODE_MAX_OLD_SPACE=4096

WORKDIR /src
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
COPY upstream/ upstream/

WORKDIR /src/upstream
RUN npm ci --force
ENV APP_BUILD_HASH=${BUILD_HASH}
# ARG must be on this RUN: ENV+ARG heap size is ignored by some Podman builds.
RUN NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE}" npm run build

COPY --from=branding /out/ /branding/
RUN cp -a /branding/. /src/upstream/build/static/ && \
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
ARG PRELOAD_MODELS=true
ENV UV_LINK_MODE=copy
RUN pip3 install --no-cache-dir uv && \
    pip3 install 'torch<=2.9.1' torchvision torchaudio \
      --index-url https://download.pytorch.org/whl/cpu --no-cache-dir && \
    uv pip install --system -r requirements.txt --no-cache-dir && \
    mkdir -p /app/backend/data && \
    if [ "${PRELOAD_MODELS}" = "true" ]; then \
      python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer(os.environ['RAG_EMBEDDING_MODEL'], device='cpu')" && \
      python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer(os.environ['AUXILIARY_EMBEDDING_MODEL'], device='cpu')" && \
      python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['WHISPER_MODEL'], device='cpu', compute_type='int8', download_root=os.environ['WHISPER_MODEL_DIR'])" && \
      python -c "import os; import tiktoken; tiktoken.get_encoding(os.environ['TIKTOKEN_ENCODING_NAME'])" && \
      python -c "import nltk; nltk.download('punkt_tab')"; \
    else \
      python -c "import nltk; nltk.download('punkt_tab')" && \
      echo "PRELOAD_MODELS=false: Whisper/embed weights download on first use"; \
    fi

# Spockify: Microsoft Edge neural TTS (no API key) for Swedish/English fallback
RUN pip3 install --no-cache-dir 'edge-tts>=6.1.0' && python -c "import edge_tts"

COPY --from=frontend-build /src/upstream/build /app/build
COPY --from=frontend-build /src/upstream/CHANGELOG.md /app/CHANGELOG.md
COPY --from=frontend-build /src/upstream/package.json /app/package.json
COPY --from=frontend-build /src/upstream/backend .

EXPOSE 8080
HEALTHCHECK CMD curl --silent --fail http://localhost:${PORT:-8080}/health | jq -ne 'input.status == true' || exit 1
CMD ["bash", "start.sh"]
