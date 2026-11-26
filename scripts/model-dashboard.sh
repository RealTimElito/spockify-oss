#!/usr/bin/env bash
# Read-only Phase 3 helper: print coding catalog + ollama ps (local / Compose).
# No pulls, no cloud hybrid, no remote SSH. See docs/MODEL_DASHBOARD.md
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG="${ROOT}/packages/spockify-harness/catalog/coding-models.v1.json"

echo "=== Spockify model dashboard (read-only) ==="
echo "Catalog: packages/spockify-harness/catalog/coding-models.v1.json"
echo "No cloud hybrid. ollama list = installed; ollama ps = loaded."
echo

print_catalog() {
  if [[ ! -f "${CATALOG}" ]]; then
    echo "(catalog missing at ${CATALOG})"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "${CATALOG}" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
print("## Promoted / explicit coding rows")
print(f"{'id':<42} {'pool':<8} {'promoted':<9} think")
print("-" * 78)
for m in data.get("models") or []:
    think = ",".join(m.get("think_allowed") or [])
    print(f"{m.get('id',''):<42} {m.get('pool',''):<8} {str(bool(m.get('promoted'))):<9} {think}")
labs = data.get("lab_models") or []
if labs:
    print()
    print("## Lab / unpublished (promoted: false — Auto never selects)")
    print(f"{'id':<42} {'pool':<8} think")
    print("-" * 60)
    for m in labs:
        think = ",".join(m.get("think_allowed") or [])
        print(f"{m.get('id',''):<42} {m.get('pool',''):<8} {think}")
PY
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    echo "## Promoted / explicit coding rows (jq)"
    jq -r '.models[] | [.id, .pool, (.promoted|tostring), (.think_allowed|join(","))] | @tsv' "${CATALOG}"
    echo
    echo "## Lab / unpublished"
    jq -r '.lab_models[]? | [.id, .pool, (.think_allowed|join(","))] | @tsv' "${CATALOG}"
    return 0
  fi
  echo "(install python3 or jq to pretty-print; raw path: ${CATALOG})"
  head -n 40 "${CATALOG}"
}

try_ollama_ps() {
  echo
  echo "=== ollama ps (loaded / residency) ==="
  if command -v ollama >/dev/null 2>&1; then
    if ollama ps 2>/dev/null; then
      return 0
    fi
  fi

  local cid=""
  if command -v podman >/dev/null 2>&1; then
    cid="$(podman ps -qf name=ollama 2>/dev/null | head -1 || true)"
    if [[ -n "${cid}" ]]; then
      echo "(via podman exec ${cid})"
      podman exec "${cid}" ollama ps 2>/dev/null && return 0
    fi
  fi
  if command -v docker >/dev/null 2>&1; then
    cid="$(docker ps -qf name=ollama 2>/dev/null | head -1 || true)"
    if [[ -n "${cid}" ]]; then
      echo "(via docker exec ${cid})"
      docker exec "${cid}" ollama ps 2>/dev/null && return 0
    fi
    if docker compose version >/dev/null 2>&1; then
      if docker compose exec -T ollama ollama ps 2>/dev/null; then
        echo "(via docker compose exec ollama)"
        return 0
      fi
    fi
  fi

  cat <<'EOF'
(no local ollama reachable)

Manual:
  ollama ps
  podman exec "$(podman ps -qf name=ollama | head -1)" ollama ps
  docker compose exec ollama ollama ps

Empty ps = nothing loaded. list = installed on disk. See docs/MODEL_DASHBOARD.md
EOF
  return 0
}

print_catalog
try_ollama_ps
echo
echo "Done (read-only)."
exit 0
