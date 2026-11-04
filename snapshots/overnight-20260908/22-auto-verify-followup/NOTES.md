# 22 — auto verify follow-up without orch review

Keeps 20–21. If digests have writes_ok but no pytest_passed, skip R1 review
and inject a pytest verify follow-up (saves a full orch LLM call on 2-round paths).
