FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py .

ENV LITELLM_URL=http://litellm:4000/v1
ENV SEARXNG_URL=http://searxng:8080
ENV ORCHESTRATOR_MODEL=nemotron-nano-4b
ENV ORCHESTRATOR_FALLBACK=llama3.2-3b
ENV ROUTING_FAST_MODE=true
ENV ORCHESTRATOR_MAX_TOKENS=256
ENV ORCHESTRATOR_PROMPT_PATH=/config/orchestrator-prompt.md

EXPOSE 4100
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4100"]
