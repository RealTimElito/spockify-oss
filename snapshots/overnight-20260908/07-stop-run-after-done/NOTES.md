# 07 — stop RUN after DONE

## Problem (06-bugfix)
Exec fixed `a - b` → `a + b` and pytest passed, then continued tool-loop with
RUN after DONE and sed'd the bug back in. fixed_on_disk=false, quality 4.

## Fix
- extract_run_commands ignores RUN lines after DONE
- exec tool loop breaks when reply contains DONE

## SWE note
v5: run_args [] applied (no --rm) but container still "not running" — twin
aarch64 running x86_64 SWE image; format errors follow. Need qemu or skip.
