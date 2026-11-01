# P1 SUMMARY — unique **12/27**; B-05 match **1/9**; test_patch strip fixed

## Scores

| Row | Score |
|-----|-------|
| Unique harness freezes | **12/27** (…, 13447, **13551**) |
| B-05 harness-resolved OC match | **1/9** (13551 OC empty) |
| Lite mini-SWE | **68/296** |
| High 12915 | **resolved** |
| High 12983 | empty not-resolved (fail kept) |
| High 13028 | empty not-resolved (fail kept) |
| High 13033 | empty not-resolved (fail kept) |
| High 13158 | nonempty not-resolved (fail kept) |
| High 13220 | nonempty not-resolved (fail kept) |
| High 13230 | nonempty after empty-continue; not-resolved (fail kept) |
| High 13265 | nonempty wrong-file; smoke-continue no edit (fail kept) |
| High 13315 | empty; test_patch corrupt via `.strip()` (fail kept) |
| High 13321 | nonempty not-resolved after strip fix (fail kept) |
| High 13401 | nonempty via continues; not-resolved (fail kept) |
| High 13447 | **resolved** |
| High 13448 | nonempty via continues; not-resolved (fail kept) |
| High 13551 | **resolved** |
| High 13590 | empty after continues; not-resolved (fail kept) |
| High 13658 | empty after continues; not-resolved (fail kept) |

## SHAs

- Resolves: 12453 `ad06744c` · 12700 `55eeae21` · 12915 `fd35db74` / `128a7603`
- B-05 12915 OC empty: `2c482278dea715c94f9600b6b220756557e2781c`
- High 12983 empty: `2c482278dea715c94f9600b6b220756557e2781c`
- High 13028 empty: `8770b00a` / stamp `2331ac62`
- High 13033 empty: `9bcfa68b` / stamp `5dda0007`
- High 13158 nonempty fail: `1ba1b36d` / stamp `3dbad7e8`
- Empty-continue driver fix: `1585dd81`
- High 13220 nonempty fail: `2374bc61` / stamp `a6e1222e`
- High 13230 nonempty fail: `4f7f4f77`
- Smoke-continue apply_patch + traceback source: `f9ce8a0f`
- High 13265 nonempty fail: `f9ce8a0f` / card `1aad070c`
- No-edit continue gate: `f49bc7d4`
- High 13315 empty fail: `f49bc7d4`
- test_patch strip + infra-skip + empty no-edit: `8e7690d8`
- High 13321 nonempty fail: `8e7690d8` / stamp `077bd2df`
- Smoke `_FailedTest`+AssertionError tighten: `418389f0`
- High 13401 nonempty fail: `a8007a2c`
- High 13447 resolve: `85b1a2d5`
- B-05 13447 OC empty: `3d75d84f`
- High 13448 nonempty fail: `41309061`
- High 13551 resolve: `2881e8c5`
- B-05 13551 OC empty: `7953c63f`
- High 13590 empty fail: `e059b76c`
- High 13658 empty fail: `3c9c0fa5`

## Status

- **B-04 Partial** — **12/27** (+**13551** High resolve)
- **B-05 Advanced** — match **1/9**
- **13315 root cause:** `_apply_test_patch` `.strip()` deleted trailing blank context → `corrupt patch at line 104`; empty-continue 0 edits was a consequence (no F2P method in tree).
- **Fix `8e7690d8`:** preserve patch bytes; infra-skip unapplicable test_patch; missing-only F2P smoke skip; no-edit after empty-continue.
- **High 13321** (post-fix): test_patch applied; nonempty 1678 B; **not-resolved**; fail kept. No Terminal Bench. N=1 ≠ board %.

## Next

Batch done: 13551 resolve · 13590 empty · 13658 empty. **No live High.** Consecutive empties → stop chain; next unused **13660** after brief diagnose (do not thrash). Banned: …13401/13447/13448/13551/13590/13658. B-05 only on new harness resolves.
