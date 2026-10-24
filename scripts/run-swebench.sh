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
  ./scripts/run-swebench.sh swe     [--subset lite|verified] [--slice 0:1|all]
                                    [--split test|dev] [--filter REGEX]
                                    [--workers 1] [--model ID] [--base-url URL]
                                    [--output DIR] [--dry-run]
                                    [--install]   # pip install mini-swe-agent

Env: SPOCKIFY_BASE_URL / SPOCKIFY_LAB_HOST / LITELLM_MASTER_KEY / SPOCKIFY_API_KEY
     SPOCKIFY_BENCH_STEP_LIMIT (default 150) / SPOCKIFY_BENCH_COST_LIMIT (default 5.0)
     SPOCKIFY_BENCH_SPLIT (default test for full board; override with --split)
     SPOCKIFY_BENCH_WALL_SEC (default 4500 one-instance; 1209600 if slice=all)
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
  local v1 tmpl step_limit cost_limit
  v1="$(api_v1 "$api_base")"
  tmpl="${BENCH_DIR}/spockify-swebench.yaml.tmpl"
  # mini-swe-agent expects openai-compatible base without forcing cloud.
  # Model name is passed as openai/<id> when using custom_llm_provider openai.
  local model_name="$model"
  if [[ "$model_name" != */* ]]; then
    model_name="openai/${model}"
  fi
  # LEAP-021: overridable step/cost budgets (defaults raised for patch finish).
  step_limit="${SPOCKIFY_BENCH_STEP_LIMIT:-150}"
  cost_limit="${SPOCKIFY_BENCH_COST_LIMIT:-5.0}"
  python3 -c '
import pathlib,sys
tmpl=pathlib.Path(sys.argv[1]).read_text()
out=tmpl.replace("{{MODEL_NAME}}", sys.argv[2])
out=out.replace("{{API_BASE}}", sys.argv[3])
out=out.replace("{{API_KEY}}", sys.argv[4])
out=out.replace("{{STEP_LIMIT}}", sys.argv[5])
out=out.replace("{{COST_LIMIT}}", sys.argv[6])
# Default image placeholder — mini-swe-agent overrides per instance.
out=out.replace("{{DOCKER_IMAGE}}", "python:3.11")
pathlib.Path(sys.argv[7]).write_text(out)
print(sys.argv[7])
' "$tmpl" "$model_name" "$v1" "$api_key" "$step_limit" "$cost_limit" "$out_cfg"
}

cmd_swe() {
  local base="$1" key="$2" model="$3"
  local subset="$4" slice="$5" filter="$6" workers="$7" output="$8"
  local dry="$9" do_install="${10}"
  local v1
  v1="$(api_v1 "$base")"

  if [[ "$do_install" == "1" ]]; then
    echo "Installing mini-swe-agent (venv)…"
    local venv="${ROOT}/.venv-bench"
    if [[ ! -x "${venv}/bin/python" ]]; then
      python3 -m venv "$venv" || {
        echo "error: python3 -m venv failed" >&2
        return 1
      }
    fi
    # Prefer venv pip (PEP 668 / externally-managed hosts).
    # shellcheck disable=SC1091
    # PATH so later `mini` / python lookups see the venv.
    export PATH="${venv}/bin:${PATH}"
    # LEAP-007: pin version (see scripts/bench/requirements-mini-swe.txt).
    local pin_file="${BENCH_DIR}/requirements-mini-swe.txt"
    local pin_spec='mini-swe-agent==1.14.4'
    if [[ -f "$pin_file" ]]; then
      pin_spec="$(grep -E '^mini-swe-agent' "$pin_file" | head -1 | tr -d '[:space:]')"
      pin_spec="${pin_spec:-mini-swe-agent==1.14.4}"
    fi
    "${venv}/bin/pip" install -U pip "$pin_spec" || {
      echo "error: pip install ${pin_spec} failed" >&2
      return 1
    }
  elif [[ -x "${ROOT}/.venv-bench/bin/python" ]]; then
    export PATH="${ROOT}/.venv-bench/bin:${PATH}"
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

  # Spockify adapters live in scripts/bench/ (LEAP empty-content + hang fixes).
  export PYTHONPATH="${BENCH_DIR}${PYTHONPATH:+:${PYTHONPATH}}"
  # Copy adapters next to generated config so imports stay reliable.
  cp -f "${BENCH_DIR}/spockify_litellm_model.py" "${output}/spockify_litellm_model.py"
  cp -f "${BENCH_DIR}/spockify_docker_env.py" "${output}/spockify_docker_env.py"
  export PYTHONPATH="${output}:${PYTHONPATH}"

  export OPENAI_API_KEY="$key"
  export LITELLM_MODEL_REGISTRY_PATH="${output}/litellm-registry.json"
  # Avoid accidental cloud defaults in litellm.
  export OPENAI_API_BASE="$v1"
  # Local models often report $0; mini-swe-agent otherwise aborts.
  export MSWEA_COST_TRACKING="${MSWEA_COST_TRACKING:-ignore_errors}"

  local args=(
    swebench
    --config "$cfg"
    --model "openai/${model#openai/}"
    --subset "$subset"
    --output "$output"
    --workers "$workers"
  )
  # Lite full board is split=test (300). Dev is only 23 (sqlfluff smoke).
  local split="${SPOCKIFY_BENCH_SPLIT:-test}"
  if [[ -n "$split" ]]; then
    args+=(--split "$split")
  fi
  # --slice all / empty → full split (no --slice flag).
  if [[ -n "$slice" && "$slice" != "all" && "$slice" != "*" ]]; then
    args+=(--slice "$slice")
  fi
  if [[ -n "$filter" ]]; then
    args+=(--filter "$filter")
  fi

  # Wall clock: finish scored instead of hanging forever (LEAP-021 run i class).
  # Default 75m for one Lite instance; 14d for full board (resume via preds.json).
  local wall_sec="${SPOCKIFY_BENCH_WALL_SEC:-}"
  if [[ -z "$wall_sec" ]]; then
    if [[ -z "$slice" || "$slice" == "all" || "$slice" == "*" ]]; then
      wall_sec=1209600
    elif [[ "$slice" =~ ^[0-9]+:[0-9]+$ ]]; then
      local a b n
      a="${slice%%:*}"
      b="${slice##*:}"
      n=$((b - a))
      if [[ "$n" -gt 5 ]]; then
        wall_sec=$((n * 7200))
      else
        wall_sec=4500
      fi
    else
      wall_sec=4500
    fi
  fi
  # Prefer Spockify launcher (wires SWE image for custom docker env class).
  # Use venv python explicitly when present.
  local py="python3"
  if [[ -x "${ROOT}/.venv-bench/bin/python" ]]; then
    py="${ROOT}/.venv-bench/bin/python"
  fi
  echo "+ timeout ${wall_sec}s ${py} -m run_mini_swe ${args[*]}"
  set +e
  timeout --signal=TERM --kill-after=60s "${wall_sec}" \
    "$py" -m run_mini_swe "${args[@]}"
  local rc=$?
  set -e
  if [[ "$rc" -eq 124 ]]; then
    echo "warn: SWE wall clock (${wall_sec}s) hit; check ${output} for partial preds" >&2
    # Still exit 0 if preds.json exists so callers treat as completed attempt.
    if [[ -f "${output}/preds.json" ]]; then
      return 0
    fi
    return 124
  fi
  return "$rc"
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
SPLIT_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --api-key) API_KEY="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --subset) SUBSET="${2:-}"; shift 2 ;;
    --slice) SLICE="${2:-}"; shift 2 ;;
    --split) SPLIT_FLAG="${2:-}"; shift 2 ;;
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

if [[ -n "$SPLIT_FLAG" ]]; then
  export SPOCKIFY_BENCH_SPLIT="$SPLIT_FLAG"
fi

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
