# 18 — salvage WRITE (and pytest) after DONE

Keeps 16+17. Models often put WRITE under ARTIFACTS after DONE → nudge cost a full LLM turn.

## Lever
- extract_writes: if none before DONE, salvage after DONE
- extract_pytest_after_done: allow RUN: pytest after DONE when WRITE was salvaged
- RUN non-pytest after DONE still ignored (no undo)
