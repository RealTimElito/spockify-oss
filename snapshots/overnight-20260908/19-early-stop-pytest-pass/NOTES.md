# 19 — early stop on harness pytest_passed + unchanged WRITE skip

Keeps 18. After WRITE+pytest succeed in one tool turn with DONE present, skip
extra executor LLM round. Identical on-disk WRITE → unchanged (no rewrite churn).

New eval: lab_queue_eval.py (FIFO + ack).
