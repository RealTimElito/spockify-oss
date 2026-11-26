#!/bin/sh
# Pull the Ollama tags this compose stack needs. Idempotent if already present.
# Runs in the background after the UI is up — a failed pull must not take chat down.
set -eu

# Lean chat for 8–12 GiB VRAM: llama3.2:3b (orchestrator) + llama3.1:8b + codestral (Tab).
# Opt-in: gemma4:12b (quality, ~8 GiB), devstral-small-2 (~15 GiB Q4; 16 GiB VRAM).
# Huge opt-in (not default): devstral-2 (~75 GiB; Spark/121 GiB class).
# Llama 3.2 has no 8B; we pull 3.1 8B and alias it as llama3.2:8b.
MODELS="${OLLAMA_PULL_MODELS:-llama3.2:3b llama3.1:8b codestral}"

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

pull_one() {
  m="$1"
  n=0
  while [ "${n}" -lt 5 ]; do
    echo "Pulling ${m}..."
    if ollama pull "${m}"; then
      return 0
    fi
    n=$((n + 1))
    echo "Retry ${n}/5 for ${m} in $((n * 5))s..."
    sleep $((n * 5))
  done
  echo "FAILED to pull ${m}" >&2
  return 1
}

failed=0
for m in ${MODELS}; do
  pull_one "${m}" || failed=1
done

# Friendly tag: user-facing "llama 3.2 8b" is Meta's 3.1 8B.
if ollama show llama3.1:8b >/dev/null 2>&1; then
  printf 'FROM llama3.1:8b\n' > /tmp/llama32-8b.Modelfile
  ollama create llama3.2:8b -f /tmp/llama32-8b.Modelfile
fi

# CPU-hot 3b: frees VRAM for 8b/codestral on laptop GPUs (compose FAST_CHAT / orchestrator).
if ollama show llama3.2:3b >/dev/null 2>&1; then
  echo "Creating llama3.2-3b-cpu (num_gpu 0)..."
  if [ -f /modelfiles/llama3.2-3b-cpu.Modelfile ]; then
    ollama create llama3.2-3b-cpu -f /modelfiles/llama3.2-3b-cpu.Modelfile || failed=1
  else
    printf 'FROM llama3.2:3b\nPARAMETER num_gpu 0\n' > /tmp/llama32-3b-cpu.Modelfile
    ollama create llama3.2-3b-cpu -f /tmp/llama32-3b-cpu.Modelfile || failed=1
  fi
  # Pin this alias only (do not set global OLLAMA_KEEP_ALIVE=-1).
  if ollama show llama3.2-3b-cpu >/dev/null 2>&1; then
    host="${OLLAMA_HOST:-http://127.0.0.1:11434}"
    echo "Warming llama3.2-3b-cpu with keep_alive=-1..."
    warm_payload='{"model":"llama3.2-3b-cpu","prompt":"warm","stream":false,"keep_alive":-1,"options":{"num_predict":1}}'
    if command -v curl >/dev/null 2>&1; then
      curl -sf "${host}/api/generate" -H 'Content-Type: application/json' \
        -d "${warm_payload}" >/dev/null \
        || echo "WARN: CPU-3b warm failed (create still ok)"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO- --header='Content-Type: application/json' \
        --post-data="${warm_payload}" "${host}/api/generate" >/dev/null \
        || echo "WARN: CPU-3b warm failed (create still ok)"
    else
      # Official ollama image has no curl/wget — load once; keep_alive stays server default.
      printf 'warm\n' | ollama run llama3.2-3b-cpu >/dev/null 2>&1 \
        || echo "WARN: CPU-3b ollama run warm failed"
      echo "NOTE: pin forever with: curl \$OLLAMA/api/generate -d '${warm_payload}'"
    fi
  fi
fi

if [ -f /modelfiles/coder.Modelfile ] && ollama show codestral >/dev/null 2>&1; then
  echo "Creating spockify-coder (Tab + code chat) from Codestral..."
  ollama create spockify-coder -f /modelfiles/coder.Modelfile || failed=1
fi

if ollama show devstral-small-2 >/dev/null 2>&1 && [ -f /modelfiles/devstral-16g.Modelfile ]; then
  echo "Capping Devstral Small 2 context for 16GB VRAM..."
  ollama create devstral-small-2 -f /modelfiles/devstral-16g.Modelfile || failed=1
fi

echo "Models ready:"
ollama list

if [ "${failed}" -ne 0 ]; then
  echo "One or more model pulls failed. Chat UI can still run. Retry: ./docker/run.sh pull-model" >&2
  exit 1
fi
