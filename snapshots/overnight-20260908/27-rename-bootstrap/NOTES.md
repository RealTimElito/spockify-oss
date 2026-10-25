# 27 — rename bootstrap

## Keep (on top of 26; **do not undo 23**)
`bootstrap_rename_plan_from_goal()` — first-turn skip orch when goal says
"rename X to Y" and workspace .py files exist.

## Live
- rename **q10 ~16s** (was ~117s with orch)
- Opt-out: `SPOCKIFY_LAB_BOOTSTRAP=0`
