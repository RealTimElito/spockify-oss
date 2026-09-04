#!/bin/sh
# Pull the Ollama tags this compose stack needs. Idempotent if already present.
set -eu

MODELS="${OLLAMA_PULL_MODELS:-llama3.2:3b}"

if [ -z "${MODELS}" ]; then
  echo "OLLAMA_PULL_MODELS is empty — skipping pulls."
  exit 0
fi

echo "Waiting for Ollama at ${OLLAMA_HOST:-http://127.0.0.1:11434}..."
i=0
until ollama list >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "${i}" -gt 90 ]; then
    echo "Ollama did not become ready" >&2
    exit 1
  fi
  sleep 2
done

for m in ${MODELS}; do
  echo "Pulling ${m}..."
  ollama pull "${m}"
done

echo "Models ready:"
ollama list
