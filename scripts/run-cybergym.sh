#!/usr/bin/env bash
# Spockify CyberGym runner — real-vulnerability-reproduction eval, separate
# track from scripts/run-swebench.sh (coding) and evaluations/agentic-pentest-harness
# (pentest-eval). See docs/CYBERGYM.md.
#
# CyberGym itself is NOT vendored in this repo — evaluations/cybergym-harness/install.sh
# clones upstream sunblaze-ucb/cybergym pinned to a fixed commit into a local venv,
# the same on-demand pattern run-swebench.sh uses for mini-swe-agent.
#
# Hard requirement (Tim, 2026-11-07): no LLM/model weights on Spock. Model
# inference for CyberGym runs on Spark only — point SPOCKIFY_BASE_URL at
# Spark (SSH tunnel or https://spockify.eu). A loopback base-url is refused
# (smoke/task) or warned on (dry-run) — see spock_local_guard() below.
set -euo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_DIR="${ROOT}/evaluations/cybergym-harness"
VENV_DIR="${CYBERGYM_VENV_DIR:-${HARNESS_DIR}/.venv}"
DEFAULT_MODEL="${SPOCKIFY_CYBERGYM_MODEL:-gpt-oss-20b}"
# Smallest task in upstream's official 10-task subset (tasks/subset10.json) —
# chosen so the Docker image pull for a first run is ~2GB, not ~10GB+.
DEFAULT_TASK="${SPOCKIFY_CYBERGYM_TASK:-oss-fuzz:42535468}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run-cybergym.sh install
  ./scripts/run-cybergym.sh dry-run  [--base-url URL] [--model ID]
  ./scripts/run-cybergym.sh smoke    [--task-id ID] [--model ID] [--base-url URL]
                                      [--difficulty level0|level1|level2|level3]
                                      [--max-steps N] [--wall-clock-s SECONDS]
                                      [--output DIR] [--skip-verify]
  ./scripts/run-cybergym.sh task <task-id> [same flags as smoke]
  ./scripts/run-cybergym.sh suite    [--offset N] [--limit N] [same flags as smoke]

The agent loop is @spockify/harness runHarness (CYBERGYM_AGENT=python
falls back to the eval-only Python loop). Both paths cap explore and then
require write_file + submit_poc. suite writes one REPORT.md per task plus
suite-report.json. That report is a lab card — not an enterprise-readiness
claim.

Env: SPOCKIFY_BASE_URL / SPOCKIFY_LAB_HOST / LITELLM_MASTER_KEY / SPOCKIFY_API_KEY
     SPOCKIFY_CYBERGYM_MODEL (default gpt-oss-20b) / SPOCKIFY_CYBERGYM_TASK
     CYBERGYM_DATA_DIR (shared per-task HF cache; default evaluations/cybergym-harness/.cache)
     CYBERGYM_API_KEY (CyberGym's OWN server admin key — not the model API key)

No weights on Spock: model inference must run on Spark. Point SPOCKIFY_BASE_URL
at Spark, e.g. SPOCKIFY_BASE_URL=https://spockify.eu, or an SSH tunnel:
    ssh -L 24001:127.0.0.1:4000 tim@example.local
    SPOCKIFY_BASE_URL=http://127.0.0.1:24001 ./scripts/run-cybergym.sh smoke
A loopback base-url is refused for smoke/task (warned for dry-run) unless
SPOCKIFY_CYBERGYM_ALLOW_LOCAL=1 (dev-only; do not use for real runs on Spock).
Docs: docs/CYBERGYM.md
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
  for cand in http://127.0.0.1:4000 http://127.0.0.1:3080 http://127.0.0.1:30400 http://127.0.0.1:30080; do
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
  for cand in "${LITELLM_MASTER_KEY:-}" "${SPOCKIFY_API_KEY:-}" "${OPENAI_API_KEY:-}"; do
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
  [[ "$base" == */v1 ]] && printf '%s' "$base" || printf '%s/v1' "$base"
}

# Hard requirement (Tim, 2026-11-07): no LLM/model weights on Spock. CyberGym
# inference must run against Spark. Spock's own compose LiteLLM/Ollama binds
# :4000 / :3080 / :30400 / :30080 on loopback — those are refused (smoke/task)
# or warned (dry-run). A *different* loopback port (e.g. :24001, this script's
# own documented `ssh -L 24001:...:4000 tim@example.local` tunnel, or any other
# SSH/port-forward to Spark) is NOT Spock-local weights and is allowed —
# bash on this side genuinely cannot tell "tunnel to Spark" from "Spock
# compose" by address alone, so the known Spock-local ports are the signal.
is_loopback_base() {
  case "$1" in
    *127.0.0.1:4000*|*localhost:4000*) return 0 ;;
    *127.0.0.1:3080*|*localhost:3080*) return 0 ;;
    *127.0.0.1:30400*|*localhost:30400*) return 0 ;;
    *127.0.0.1:30080*|*localhost:30080*) return 0 ;;
    *) return 1 ;;
  esac
}

spock_local_guard() {
  local base="$1" hard="$2"
  if [[ "${SPOCKIFY_CYBERGYM_ALLOW_LOCAL:-0}" == "1" ]]; then
    return 0
  fi
  if ! is_loopback_base "$base"; then
    return 0
  fi
  {
    echo "warn: --base-url resolved to a loopback address (${base})."
    echo "  Spock must not hold LLM/model weights — CyberGym inference runs on Spark only."
    echo "  Point SPOCKIFY_BASE_URL at Spark, e.g.:"
    echo "    ssh -L 24001:127.0.0.1:4000 tim@example.local   # then SPOCKIFY_BASE_URL=http://127.0.0.1:24001"
    echo "    SPOCKIFY_BASE_URL=https://spockify.eu        # prod, routes to Spark"
    echo "  (dev-only override: SPOCKIFY_CYBERGYM_ALLOW_LOCAL=1 — never use this on Spock for real runs)"
  } >&2
  if [[ "$hard" == "1" ]]; then
    echo "error: refusing to run — see warning above. Set SPOCKIFY_BASE_URL to Spark." >&2
    return 1
  fi
  return 0
}

cmd_dry_run() {
  local base="$1" key="$2" model="$3"
  local v1
  v1="$(api_v1 "$base")"
  spock_local_guard "$base" "0" || true
  echo "=== Spockify CyberGym dry-run ==="
  echo "base:  ${base}"
  echo "v1:    ${v1}"
  echo "model: ${model}"
  echo "task:  ${DEFAULT_TASK} (default)"
  echo

  if [[ -z "$key" ]]; then
    echo "error: no API key (LITELLM_MASTER_KEY / SPOCKIFY_API_KEY / spockify login)" >&2
    return 1
  fi
  echo "--- GET ${v1}/models ---"
  if ! curl -sfS -H "Authorization: Bearer ${key}" "${v1}/models" >/dev/null; then
    echo "warn: cannot list models at ${v1}/models (API down?)" >&2
  else
    echo "ok: model API reachable"
  fi

  echo "--- harness install check ---"
  if [[ -x "${VENV_DIR}/bin/python" ]]; then
    if "${VENV_DIR}/bin/python" -c "import cybergym" 2>/dev/null; then
      echo "ok: cybergym importable in ${VENV_DIR}"
    else
      echo "warn: venv exists but cybergym not importable — rerun install" >&2
    fi
  else
    echo "not installed yet — run: ./scripts/run-cybergym.sh install" >&2
  fi

  echo "--- docker check ---"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "ok: docker available"
  else
    echo "warn: docker not available — CyberGym's own verification images need it" >&2
  fi

  echo
  echo "dry-run ok (no downloads, no docker pulls, no server started)"
}

run_task() {
  local task_id="$1" model="$2" base="$3" key="$4" difficulty="$5" max_steps="$6" output="$7" skip_verify="$8" wall_clock_s="$9"
  if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    echo "error: harness not installed. Run: ./scripts/run-cybergym.sh install" >&2
    return 127
  fi
  if [[ -z "$key" ]]; then
    echo "error: no API key for the model endpoint" >&2
    return 1
  fi
  spock_local_guard "$base" "1" || return 1
  mkdir -p "$output"
  chmod 755 "$output"
  local args=(
    "${HARNESS_DIR}/src/run_task.py"
    --task-id "$task_id"
    --difficulty "$difficulty"
    --model "$model"
    --base-url "$base"
    --api-key "$key"
    --max-steps "$max_steps"
    --wall-clock-s "$wall_clock_s"
    --output "$output"
    --python-bin "${VENV_DIR}/bin/python"
  )
  [[ "$skip_verify" == "1" ]] && args+=(--skip-verify)

  echo "=== Spockify CyberGym task run ==="
  echo "task=${task_id}  difficulty=${difficulty}  model=${model}"
  echo "output=${output}"
  echo "Note: first run per task-id pulls Docker verification image(s) from"
  echo "Docker Hub (n132/arvo or cybergym/oss-fuzz) — size varies by task,"
  echo "~1-2GB each for the official 10-task subset. See docs/CYBERGYM.md."
  echo
  PYTHONUNBUFFERED=1 "${VENV_DIR}/bin/python" "${args[@]}"
}

main() {
  local mode="${1:-help}"
  shift || true

  local base_url="" api_key="" model="$DEFAULT_MODEL" task_id="$DEFAULT_TASK"
  local difficulty="level1" max_steps="24" wall_clock_s="1800" output="" skip_verify="0"
  local suite_limit="0" suite_offset="0"

  if [[ "$mode" == "task" ]]; then
    if [[ "${1:-}" != "" && "${1:-}" != --* ]]; then
      task_id="$1"
      shift
    fi
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-url) base_url="$2"; shift 2 ;;
      --api-key) api_key="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      --task-id) task_id="$2"; shift 2 ;;
      --difficulty) difficulty="$2"; shift 2 ;;
      --max-steps) max_steps="$2"; shift 2 ;;
      --wall-clock-s) wall_clock_s="$2"; shift 2 ;;
      --output) output="$2"; shift 2 ;;
      --skip-verify) skip_verify="1"; shift ;;
      --limit) suite_limit="$2"; shift 2 ;;
      --offset) suite_offset="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "warn: unknown arg: $1" >&2; shift ;;
    esac
  done

  case "$mode" in
    help|-h|--help) usage ;;
    install)
      chmod +x "${HARNESS_DIR}/install.sh"
      "${HARNESS_DIR}/install.sh"
      ;;
    dry-run)
      local base key
      base="$(resolve_base_url "$base_url")"
      key="$(resolve_api_key "$api_key")"
      cmd_dry_run "$base" "$key" "$model"
      ;;
    smoke|task)
      local base key
      base="$(resolve_base_url "$base_url")"
      key="$(resolve_api_key "$api_key")"
      if [[ -z "$output" ]]; then
        output="${ROOT}/bench-out/cybergym-$(date +%Y%m%d-%H%M%S)"
      fi
      run_task "$task_id" "$model" "$base" "$key" "$difficulty" "$max_steps" "$output" "$skip_verify" "$wall_clock_s"
      ;;
    suite)
      local base key suite_dir
      base="$(resolve_base_url "$base_url")"
      key="$(resolve_api_key "$api_key")"
      if [[ -z "$output" ]]; then
        suite_dir="${ROOT}/bench-out/cybergym-suite-$(date +%Y%m%d-%H%M%S)"
      else
        suite_dir="$output"
      fi
      mkdir -p "$suite_dir"
      chmod 755 "$suite_dir"
      mapfile -t suite_ids < <("${VENV_DIR}/bin/python" -c '
import json,sys
rows=json.load(open(sys.argv[1]))
for row in rows:
    print(row["task_id"])
' "${HARNESS_DIR}/tasks/subset10.json")
      if [[ "$suite_offset" != "0" ]]; then
        suite_ids=("${suite_ids[@]:$suite_offset}")
      fi
      if [[ "$suite_limit" != "0" ]]; then
        suite_ids=("${suite_ids[@]:0:$suite_limit}")
      fi
      echo "suite: ${#suite_ids[@]} task(s) -> ${suite_dir}"
      local id safe
      for id in "${suite_ids[@]}"; do
        safe="${id//:/-}"
        run_task "$id" "$model" "$base" "$key" "$difficulty" "$max_steps" "${suite_dir}/${safe}" "$skip_verify" "$wall_clock_s" || true
      done
      "${VENV_DIR}/bin/python" "${HARNESS_DIR}/src/suite_report.py" "$suite_dir"
      ;;
    *)
      echo "error: unknown mode: $mode" >&2
      usage
      exit 2
      ;;
  esac
}

main "$@"
