# 17 — preseed pytest failures (speed) + nested pkg eval

Keeps 16. Prefer source cats + `pytest -q` over cat test_*; cap 5 when pytest in goal.
Exec: if pytest already failed in preseed, WRITE then re-verify.

New eval: lab_pkg_eval.py (util package clamp + export normalize).
