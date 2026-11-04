# 24 — docs bootstrap + tighter pytest-verify detection

## Keep (on top of 23)
1. `goal_needs_pytest_verify()` — "pytest passes" / run-verify only; **not** propose/draft.
2. `bootstrap_docs_plan_from_goal()` — WRITE API.md/README-style goals skip orch.
3. Review skip + early-stop for non-pytest when `writes_ok`.
4. Orch prompt: docs from RUN:cat observations only.
5. Opt-out still `SPOCKIFY_LAB_BOOTSTRAP=0` (covers docs bootstrap too).

## Live twin
| Eval | Quality | Wall | Notes |
|------|---------|------|-------|
| docs | **10** | **~12s** | docs bootstrap + write + skip review |
| rename | **10** | ~117s | orch path (no false bootstrap) |
| micro propose | **10** | ~154s | orch, **no** pytest bootstrap |
| calc regress | **10** | **~17s** | pytest bootstrap intact (≤23) |

## Do not undo
23 first-turn pytest bootstrap remains.
