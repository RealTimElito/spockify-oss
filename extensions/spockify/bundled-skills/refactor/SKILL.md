---
title: Safe refactor
category: engineering
tags: [refactor, cleanup]
---
# Safe refactor

Refactor without changing behavior.

1. State the goal (simpler, smaller, clearer, faster) in one sentence.
2. Identify the exact scope. Do not expand it.
3. Make sure there is a way to verify behavior (existing tests, or a small characterization check).
4. Change in small steps. Prefer renaming and extracting over rewriting.
5. After each meaningful step, re-check that behavior is unchanged.
6. Summarize what moved and what stayed the same.

Do not mix feature work into a refactor. If you spot a bug, call it out separately.
