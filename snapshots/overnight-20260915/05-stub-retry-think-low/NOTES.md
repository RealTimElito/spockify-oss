# 05 — tip 53 stub-retry + think=low

## Tip 53 (on tip 52)
- `is_stub_exec_reply` + usable_reply rejects “We need” stubs
- One nudge retry when first exec reply is a stub
- Default `SPOCKIFY_LAB_EXEC_THINK=low` / `ORCH_THINK=low` (gpt-oss)
- llm.chat_result passes `think=` through LiteLLM

## Live (Spark careful)
- tip53 rate micro: WRITE → auto pytest → **3 passed** · wall **~9.4s** · review skipped
- tip52 same fixture was soft (stubs only)

## Cursor
- CLI TUI also surfaces `spockify_agents` status lines
