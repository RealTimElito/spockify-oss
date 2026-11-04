# 21 — auto pytest after WRITE

Keeps 20. If WRITE applied for a test goal and no RUN cmds remain, harness
runs `pytest -q` so early-stop + review-skip can fire in one tool turn.

New eval: lab_cache_eval.py (TTL + stale store).
