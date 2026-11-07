#!/usr/bin/env bash
# Phase 4 exit: single loop body in packages/spockify-harness (IDE/lab must not fork one).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

fail() { echo "PHASE4-PENDING: $*" >&2; exit 2; }

# 1) No second export async function runAgentTurn outside harness + CLI thin wrap.
HITS="$(rg -n '^export async function runAgentTurn' "$ROOT" \
  --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/.git/**' \
  --glob '!**/test/**' --glob '!**/*.test.ts' --glob '!**/_archive/**' || true)"
OFFENDERS="$(echo "$HITS" \
  | grep -v 'packages/spockify-harness/src/loop.ts' \
  | grep -v 'packages/spockify-cli/src/agent/loop.ts' \
  | sed '/^$/d' || true)"
if [[ -n "$OFFENDERS" ]]; then
  fail "second runAgentTurn still present:"$'\n'"$OFFENDERS"
fi

IDE_LOOP="$ROOT/extensions/spockify/src/runtime/agentLoop.ts"
if [[ ! -f "$IDE_LOOP" ]]; then
  fail "missing IDE agentLoop.ts"
fi

# 2) IDE must import runHarness (not a private while/for tool dispatch body).
if ! rg -q "from '@spockify/harness'" "$IDE_LOOP" && ! rg -q 'from "@spockify/harness"' "$IDE_LOOP"; then
  fail "IDE agentLoop.ts does not import @spockify/harness"
fi
if ! rg -q 'runHarness' "$IDE_LOOP"; then
  fail "IDE agentLoop.ts does not call runHarness"
fi

if rg -n 'for \(let turn|while \(true\)|while \(!cancelled' "$IDE_LOOP" >/dev/null 2>&1; then
  if rg -n 'registry\.call|mergeToolCalls|parseToolCalls|nativeAcc|execute\(call' "$IDE_LOOP" >/dev/null 2>&1; then
    fail "IDE agentLoop.ts still has private while/for + tool dispatch"
  fi
fi

LINES="$(wc -l < "$IDE_LOOP" | tr -d ' ')"
if [[ "$LINES" -gt 280 ]]; then
  fail "IDE agentLoop.ts is $LINES lines (expected thin bridge; archive private body)"
fi

# 3) Lab must reach runHarness (stdio adapter and/or kernel_bridge).
LAB_STDIO="$ROOT/packages/spockify-harness/scripts/lab-kernel-stdio.ts"
LAB_BRIDGE="$ROOT/packages/spockify-lab-agents/spockify_lab_agents/kernel_bridge.py"
LAB_PKG="$ROOT/packages/spockify-lab-agents/spockify_lab_agents"
if [[ ! -f "$LAB_STDIO" ]] || ! rg -q 'runHarness' "$LAB_STDIO"; then
  fail "lab-kernel-stdio.ts missing or does not import runHarness"
fi
if [[ ! -f "$LAB_BRIDGE" ]] || ! rg -q 'lab-kernel-stdio' "$LAB_BRIDGE"; then
  fail "kernel_bridge.py missing or does not point at lab-kernel-stdio"
fi
if rg -n 'def run_shell|def apply_writes|class ShellTool' \
  "$LAB_BRIDGE" >/dev/null 2>&1; then
  fail "kernel_bridge.py must not implement shell/edit tools"
fi

# 4) Tip-50 tools only under _archive; default must be kernel (not legacy).
PY_TOOL_HITS="$(rg -n '^def run_shell|^def apply_writes' "$LAB_PKG" \
  --glob '!**/_archive/**' --glob '!**/.venv/**' || true)"
if [[ -n "$PY_TOOL_HITS" ]]; then
  fail "Python run_shell/apply_writes still live outside _archive:"$'\n'"$PY_TOOL_HITS"
fi
if [[ ! -f "$LAB_PKG/_archive/tip50/shell_tool.py" ]]; then
  fail "missing _archive/tip50/shell_tool.py"
fi
if ! rg -q 'SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS' "$LAB_BRIDGE"; then
  fail "kernel_bridge.py must document SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS dead flag"
fi
if ! rg -q 'use_legacy_python_tools' "$LAB_PKG/loop.py"; then
  fail "loop.py must gate tip-50 tools behind use_legacy_python_tools"
fi
if ! rg -q '_exec_via_kernel|run_kernel_tools' "$LAB_PKG/loop.py"; then
  fail "loop.py default path must call run_kernel_tools / _exec_via_kernel"
fi
# Default must NOT be legacy (kernel is default).
if ! python3 -c "
import sys
sys.path.insert(0, '$ROOT/packages/spockify-lab-agents')
import os
os.environ.pop('SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS', None)
from spockify_lab_agents.kernel_bridge import use_legacy_python_tools
raise SystemExit(0 if not use_legacy_python_tools() else 1)
"; then
  fail "lab default must be kernel (use_legacy_python_tools() False without env)"
fi

echo "PHASE4-GREEN: single loop body in packages/spockify-harness"
