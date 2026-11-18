# 10 — WRITE before DONE + review pytest gate

## 09 miss
Exec put WRITE under ARTIFACTS after DONE → harness ignored; review later claimed done without pytest pass. quality 4.

## Fix (keeps 08+09)
1. Exec prompt: RUN/WRITE must precede DONE
2. One-shot nudge when tools appear only after DONE
3. Review: require real pytest observation before done when goal needs tests
