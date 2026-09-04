#!/bin/sh
# Pull the Ollama tags this compose stack needs. Idempotent if already present.
set -eu

# Chat: llama3.2:3b + llama3.1:8b + gemma4:12b. Tab FIM: codestral.
# Agentic coder: devstral-small-2 (~15GB Q4; 8k ctx so it fits 16GB VRAM).
# Llama 3.2 has no 8B; we pull 3.1 8B and alias it as llama3.2:8b.
MODELS="${OLLAMA_PULL_MODELS:-llama3.2:3b llama3.1:8b gemma4:12b codestral devstral-small-2}"

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

# Friendly tag: user-facing "llama 3.2 8b" is Meta's 3.1 8B.
if ollama show llama3.1:8b >/dev/null 2>&1; then
  printf 'FROM llama3.1:8b\n' > /tmp/llama32-8b.Modelfile
  ollama create llama3.2:8b -f /tmp/llama32-8b.Modelfile
fi

if [ -f /modelfiles/coder.Modelfile ]; then
  echo "Creating spockify-coder (Tab + code chat) from Codestral..."
  ollama create spockify-coder -f /modelfiles/coder.Modelfile
fi

if ollama show devstral-small-2 >/dev/null 2>&1 && [ -f /modelfiles/devstral-16g.Modelfile ]; then
  echo "Capping Devstral Small 2 context for 16GB VRAM..."
  ollama create devstral-small-2 -f /modelfiles/devstral-16g.Modelfile
fi

echo "Models ready:"
ollama list
