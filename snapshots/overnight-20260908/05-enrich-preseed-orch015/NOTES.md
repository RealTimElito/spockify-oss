# 05 — enrich RUN: + shell preseed + orch temp 0.15

Keeps 04 shell tool. Adds:
1. enrich_task_instructions: "Run 'ls'" → RUN: ls
2. preseed_shell_observations: run inspect cmds before first LLM turn
3. ORCH_TEMP default 0.15 (was 0.2); env SPOCKIFY_LAB_ORCH_TEMP / EXEC_TEMP
