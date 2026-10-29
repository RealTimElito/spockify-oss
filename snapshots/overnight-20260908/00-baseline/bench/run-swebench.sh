#!/usr/bin/env bash
# Spockify coding-bench runner (dry-run / smoke / SWE-bench Lite wrapper).
# See docs/BENCH.md — twin or compose only; local models; no cloud tags.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH_DIR="${ROOT}/scripts/bench"
DEFAULT_MODEL="${SPOCKIFY_BENCH_MODEL:-gpt-oss-20b}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run-swebench.sh dry-run [--base-url URL] [--model ID]
  ./scripts/run-swebench.sh smoke   [--base-url URL] [--model ID]
  ./scripts/run-swebench.sh swe     [--subset lite|verified] [--slice 0:1]
                                    [--filter REGEX] [--workers 1]
                                    [--model ID] [--base-url URL]
                                    [--output DIR] [--dry-run]
                                    [--install]   # pip install mini-swe-agent

Env: SPOCKIFY_BASE_URL / SPOCKIFY_LAB_HOST / LITELLM_MASTER_KEY / SPOCKIFY_API_KEY
Docs: docs/BENCH.md
EOF
}

owui_to_litellm() {
  local url="${1%/}"
  url="${url/:30080/:30400}"
  url="${url/:3080/:4000}"
  printf '%s' "$url"
}

resolve_base_url() {
  local explicit="${1:-}"
  if [[ -n "$explicit" ]]; then
    owui_to_litellm "$explicit"
    return
  fi
  for cand in \
    "${SPOCKIFY_LAB_BASE_URL:-}" \
    "${SPOCKIFY_BASE_URL:-}" \
    "${LITELLM_BASE_URL:-}" \
    "${OPENAI_BASE_URL:-}"; do
    if [[ -n "${cand}" ]]; then
      owui_to_litellm "$cand"
      return
    fi
  done
  if [[ -n "${SPOCKIFY_LAB_HOST:-}" ]]; then
    printf 'http://%s:30400' "${SPOCKIFY_LAB_HOST}"
    return
  fi
  if [[ -n "${SPOCKIFY_LAB_TWIN:-}" ]] || [[ -d /home/lab/agentHub ]]; then
    printf 'http://127.0.0.1:30400'
    return
  fi
  # Prefer compose LiteLLM, then OWUI (remapped), then lab NodePort.
  for cand in \
    http://127.0.0.1:4000 \
    http://127.0.0.1:3080 \
    http://127.0.0.1:30400 \
    http://127.0.0.1:30080; do
    if curl -sf -o /dev/null --connect-timeout 1 "${cand}/health" 2>/dev/null \
      || curl -sf -o /dev/null --connect-timeout 1 "${cand}/v1/models" 2>/dev/null; then
      owui_to_litellm "$cand"
      return
    fi
  done
  printf 'http://127.0.0.1:4000'
}

resolve_api_key() {
  local explicit="${1:-}"
  if [[ -n "$explicit" ]]; then
    printf '%s' "$explicit"
    return
  fi
  for cand in \
    "${LITELLM_MASTER_KEY:-}" \
    "${SPOCKIFY_API_KEY:-}" \
    "${OPENAI_API_KEY:-}"; do
    if [[ -n "${cand}" ]]; then
      printf '%s' "$cand"
      return
    fi
  done
  local cred="${XDG_CONFIG_HOME:-$HOME/.config}/spockify/credentials.json"
  if [[ -f "$cred" ]]; then
    python3 -c '
import json,sys
try:
  d=json.load(open(sys.argv[1]))
  print((d.get("accessToken") or "").strip(), end="")
except Exception:
  pass
' "$cred" 2>/dev/null || true
    return
  fi
  printf ''
}

api_v1() {
  local base="${1%/}"
  if [[ "$base" == */v1 ]]; then
    printf '%s' "$base"
  else
    printf '%s/v1' "$base"
  fi
}

cmd_dry_run() {
  local base="$1" key="$2" model="$3"
  local v1
  v1="$(api_v1 "$base")"
  echo "=== Spockify bench dry-run ==="
  echo "base:  ${base}"
  echo "v1:    ${v1}"
  echo "model: ${model}"
  if [[ -z "$key" ]]; then
    echo "error: no API key (LITELLM_MASTER_KEY / SPOCKIFY_API_KEY / spockify login)" >&2
    return 1
  fi
  echo "--- GET ${v1}/models ---"
  local models_json
  if ! models_json="$(curl -sfS -H "Authorization: Bearer ${key}" "${v1}/models")"; then
    echo "error: cannot list models at ${v1}/models" >&2
    return 1
  fi
  python3 -c '
import json,sys
d=json.loads(sys.argv[1])
ids=[m.get("id") for m in d.get("data") or []]
want=sys.argv[2]
print(f"models: {len(ids)}")
print("sample:", ", ".join(ids[:8]) + ("…" if len(ids)>8 else ""))
if want not in ids and not any(want==i or want in (i or "") for i in ids):
  # soft warn — aliases may not appear in /models the same way
  print(f"warn: model {want!r} not in /models list (may still route via LiteLLM alias)")
else:
  print(f"ok: model {want!r} present")
' "$models_json" "$model"
  echo "--- POST ${v1}/chat/completions (max_tokens=8) ---"
  local body
  body="$(python3 -c '
import json,sys
print(json.dumps({
  "model": sys.argv[1],
  "messages": [{"role":"user","content":"Reply with exactly: pong"}],
  "max_tokens": 8,
  "stream": False,
}))
' "$model")"
  local out
  out="$(curl -sfS \
    -H "Authorization: Bearer ${key}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${v1}/chat/completions")"
  python3 -c '
import json,sys
d=json.loads(sys.argv[1])
c=(d.get("choices") or [{}])[0].get("message",{}).get("content") or ""
print("reply:", (c.strip() or "<empty>")[:200])
print("dry-run ok")
' "$out"
}

cmd_smoke() {
  local base="$1" key="$2" model="$3"
  local v1
  v1="$(api_v1 "$base")"
  echo "=== Spockify bench smoke (one coding completion) ==="
  echo "model=${model}  v1=${v1}"
  if [[ -z "$key" ]]; then
    echo "error: no API key" >&2
    return 1
  fi
  local body
  body="$(python3 -c '
import json,sys
print(json.dumps({
  "model": sys.argv[1],
  "messages": [{
    "role":"user",
    "content":(
      "Write a Python function is_palindrome(s: str) -> bool. "
      "Return only the function, no markdown."
    ),
  }],
  "max_tokens": 256,
  "stream": False,
}))
' "$model")"
  local t0 t1 out
  t0="$(date +%s)"
  out="$(curl -sfS \
    -H "Authorization: Bearer ${key}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${v1}/chat/completions")"
  t1="$(date +%s)"
  python3 -c '
import json,sys
d=json.loads(sys.argv[1])
c=(d.get("choices") or [{}])[0].get("message",{}).get("content") or ""
print(c.strip()[:1200])
print("---")
print(f"elapsed_s={sys.argv[2]}")
print("smoke ok")
' "$out" "$((t1 - t0))"
}

write_swe_config() {
  local out_cfg="$1" model="$2" api_base="$3" api_key="$4"
  local v1 tmpl
  v1="$(api_v1 "$api_base")"
  tmpl="${BENCH_DIR}/spockify-swebench.yaml.tmpl"
  # mini-swe-agent expects openai-compatible base without forcing cloud.
  # Model name is passed as openai/<id> when using custom_llm_provider openai.
  local model_name="$model"
  if [[ "$model_name" != */* ]]; then
    model_name="openai/${model}"
  fi
  python3 -c '
import pathlib,sys
tmpl=pathlib.Path(sys.argv[1]).read_text()
out=tmpl.replace("{{MODEL_NAME}}", sys.argv[2])
out=out.replace("{{API_BASE}}", sys.argv[3])
out=out.replace("{{API_KEY}}", sys.argv[4])
# Default image placeholder — mini-swe-agent overrides per instance.
out=out.replace("{{DOCKER_IMAGE}}", "python:3.11")
pathlib.Path(sys.argv[5]).write_text(out)
print(sys.argv[5])
' "$tmpl" "$model_name" "$v1" "$api_key" "$out_cfg"
}

cmd_swe() {
  local base="$1" key="$2" model="$3"
  local subset="$4" slice="$5" filter="$6" workers="$7" output="$8"
  local dry="$9" do_install="${10}"
  local v1
  v1="$(api_v1 "$base")"

  if [[ "$do_install" == "1" ]]; then
    echo "Installing mini-swe-agent (pip)…"
    python3 -m pip install -U 'mini-swe-agent' || {
      echo "error: pip install mini-swe-agent failed" >&2
      return 1
    }
  fi

  if [[ -z "$key" ]]; then
    echo "error: no API key" >&2
    return 1
  fi

  mkdir -p "$output"
  local cfg="${output}/spockify-swebench.yaml"
  write_swe_config "$cfg" "$model" "$base" "$key"
  cp -f "${BENCH_DIR}/litellm-registry.json" "${output}/litellm-registry.json"

  echo "=== Spockify SWE-bench wrapper ==="
  echo "subset=${subset}  slice=${slice}  workers=${workers}"
  echo "model=${model}  v1=${v1}"
  echo "output=${output}"
  echo "config=${cfg}"
  echo
  echo "Note: full Lite/Verified pulls HuggingFace data + Docker images."
  echo "Keep --slice tiny on first runs. Twin only for long jobs. See docs/BENCH.md"
  echo

  if [[ "$dry" == "1" ]]; then
    echo "dry-run: config written; skipping mini-extra / HF download"
    if cmd_dry_run "$base" "$key" "$model"; then
      echo "swe dry-run ok (API reachable; no instances run)"
    else
      echo "warn: API probe failed (stack down or bad key); config still written" >&2
      echo "swe dry-run ok (config only; no instances run)"
    fi
    return 0
  fi

  if ! command -v mini-extra >/dev/null 2>&1; then
    echo "error: mini-extra not on PATH." >&2
    echo "  ./scripts/run-swebench.sh swe --install --subset lite --slice 0:1 …" >&2
    echo "  or: python3 -m pip install mini-swe-agent" >&2
    return 127
  fi

  export OPENAI_API_KEY="$key"
  export LITELLM_MODEL_REGISTRY_PATH="${output}/litellm-registry.json"
  # Avoid accidental cloud defaults in litellm.
  export OPENAI_API_BASE="$v1"

  local args=(
    swebench
    --config "$cfg"
    --model "openai/${model#openai/}"
    --subset "$subset"
    --output "$output"
    --workers "$workers"
  )
  # Default split: lite often uses "dev" or "test" depending on version — pass through env override.
  if [[ -n "${SPOCKIFY_BENCH_SPLIT:-}" ]]; then
    args+=(--split "${SPOCKIFY_BENCH_SPLIT}")
  fi
  if [[ -n "$slice" ]]; then
    args+=(--slice "$slice")
  fi
  if [[ -n "$filter" ]]; then
    args+=(--filter "$filter")
  fi

  echo "+ mini-extra ${args[*]}"
  mini-extra "${args[@]}"
}

# --- argv ---
MODE="${1:-}"
shift || true
if [[ -z "$MODE" || "$MODE" == "-h" || "$MODE" == "--help" || "$MODE" == "help" ]]; then
  usage
  exit 0
fi

BASE_URL=""
API_KEY=""
MODEL="$DEFAULT_MODEL"
SUBSET="lite"
SLICE="0:1"
FILTER=""
WORKERS="1"
OUTPUT=""
DRY=0
INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --api-key) API_KEY="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --subset) SUBSET="${2:-}"; shift 2 ;;
    --slice) SLICE="${2:-}"; shift 2 ;;
    --filter) FILTER="${2:-}"; shift 2 ;;
    --workers) WORKERS="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --install) INSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

BASE="$(resolve_base_url "$BASE_URL")"
KEY="$(resolve_api_key "$API_KEY")"
if [[ -z "$OUTPUT" ]]; then
  OUTPUT="${ROOT}/bench-out/$(date +%Y%m%d-%H%M%S)"
fi

case "$MODE" in
  dry-run|probe)
    cmd_dry_run "$BASE" "$KEY" "$MODEL"
    ;;
  smoke)
    cmd_smoke "$BASE" "$KEY" "$MODEL"
    ;;
  swe|swebench|lite)
    cmd_swe "$BASE" "$KEY" "$MODEL" "$SUBSET" "$SLICE" "$FILTER" "$WORKERS" "$OUTPUT" "$DRY" "$INSTALL"
    ;;
  *)
    echo "unknown mode: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac
