#!/usr/bin/env bash
# Prune unused SWE-bench Docker images when disk is tight.
# Safe: only removes swebench/* images not used by a running container.
set -euo pipefail

MIN_FREE_GB="${SPOCKIFY_BENCH_MIN_FREE_GB:-40}"
KEEP_RECENT="${SPOCKIFY_BENCH_KEEP_SWE_IMAGES:-3}"

free_gb() {
  df -BG / | awk 'NR==2 {gsub(/G/,"",$4); print $4}'
}

echo "disk free: $(free_gb)G (min ${MIN_FREE_GB}G)"

# IDs of images backing running containers.
IN_USE="$(docker ps -q | xargs -r docker inspect -f '{{.Image}}' 2>/dev/null | sort -u || true)"

removed=0
# Oldest first.
while IFS=$'\t' read -r id ref; do
  [[ -z "${id:-}" ]] && continue
  if printf '%s\n' "$IN_USE" | grep -q "$id"; then
    continue
  fi
  free_now="$(free_gb)"
  left="$(docker images -q 'swebench/*' | wc -l)"
  if [[ "$free_now" -ge "$MIN_FREE_GB" && "$left" -le 12 ]]; then
    break
  fi
  if [[ "$left" -le "$KEEP_RECENT" ]]; then
    break
  fi
  echo "removing unused $ref ($id)"
  docker rmi -f "$id" >/dev/null 2>&1 || true
  removed=$((removed + 1))
done < <(
  docker images --format '{{.ID}}\t{{.Repository}}:{{.Tag}}' 'swebench/*' 2>/dev/null \
    | tac
)

# Only remove *exited* harness containers — never force-rm a running agent box.
docker ps -a --filter 'name=minisweagent-' --filter 'status=exited' --format '{{.ID}}' \
  | xargs -r docker rm >/dev/null 2>&1 || true
docker ps -a --filter 'name=minisweagent-' --filter 'status=dead' --format '{{.ID}}' \
  | xargs -r docker rm -f >/dev/null 2>&1 || true

# Orphan guard: mini-swe sometimes leaves prior boxes up (run_args=[] / async stop).
# docker ps lists newest first — keep the first ID, remove the rest.
mapfile -t LIVE < <(docker ps --filter 'name=minisweagent-' --format '{{.ID}}')
if [[ "${#LIVE[@]}" -gt 1 ]]; then
  for ((i = 1; i < ${#LIVE[@]}; i++)); do
    oid="${LIVE[$i]}"
    echo "removing orphaned running container $oid"
    docker rm -f "$oid" >/dev/null 2>&1 || true
  done
fi

echo "pruned=$removed free_now=$(free_gb)G swe_left=$(docker images -q 'swebench/*' | wc -l)"
