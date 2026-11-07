# 02 — first-turn force exec

## Problem (01 live)
lab-orchestrator (R1) returned status=done with tasks=[] on round 1 after
hallucinating ls/cat in thinking — never spawned executors (quality false-positive).

## Fix
1. Prompt: first turn without digests MUST continue with ≥1 task; no self-inspection claims.
2. Runtime guard: if first plan is done+empty, force a default inspect task.
3. Micro-eval score: stop without handoff is penalized.

## Expected
Real plan→exec→handoff→review path on twin.
