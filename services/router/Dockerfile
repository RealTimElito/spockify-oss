FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py .

ENV LITELLM_URL=http://litellm:4000/v1
ENV SEARXNG_URL=http://searxng:8080
ENV OLLAMA_URL=http://ollama:11434
ENV ORCHESTRATOR_MODEL=llama3.2-3b
ENV ORCHESTRATOR_FALLBACK=llama3.2-3b
ENV ROUTING_FAST_MODE=true
ENV ORCHESTRATOR_MAX_TOKENS=256
ENV ORCHESTRATOR_PROMPT_PATH=/config/orchestrator-prompt.md
ENV PREWARM_ON_STARTUP=false
ENV PLAYWRIGHT_LOCAL=0

EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:4100/health || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4100"]
