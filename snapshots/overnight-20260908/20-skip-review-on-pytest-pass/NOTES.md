# 20 — skip orch review when harness pytest_passed

Keeps 18+19. After exec digests show pytest_passed and no FAILED workers,
skip R1 review LLM call and stop (tests are the goal signal).

Pairs with early-stop on executor tool loop.
