# 04 — real allowlisted shell for executors

## Problem
Executors were prompted to "use shell" but the harness never ran commands —
models invented ls/cat output (wrong greet casing / missing defaults).

## Fix
- `shell_tool.py`: RUN: / ```run``` extraction, allowlist, no pipes/chaining
- Exec tool loop (≤3 rounds): RUN → observations → DONE
- Orch told to ask for RUN: in task instructions

## Expected
Findings match real hello.py (`hello, {name}` with default).
