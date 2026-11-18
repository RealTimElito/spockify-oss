# 46 — invent filter+nudge, parens/minstack, auto-verify reset

## Keep (on top of 45 / 44)
1. Harness filters invent `cat test_*` / `ls` when task forbids reinspect.
2. If model only emits those RUNs, nudge to WRITE+pytest (don’t exit empty).
3. Reset auto-verify counter when entering orch review (fresh small budget).
4. Evals: minstack (45), parens (is_valid + longest_valid).

## Live (46b)
- parens **q10 ~132s** (was q5 ~910s thrash)
- invent variance ~167s on one bad empty-cat turn — nudge targets that
- micro **~66s**; docs ~12s; merge/lru q10

## Do not undo
44 / 42 / 34 foundation.
