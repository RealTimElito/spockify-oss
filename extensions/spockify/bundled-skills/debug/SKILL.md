---
title: Systematic debugging
category: engineering
tags: [debug, bugs, errors]
---
# Systematic debugging

When the user reports a bug or unexpected behavior:

1. **Reproduce** — confirm the exact steps, input, and expected vs actual result. Ask if unclear.
2. **Locate** — use `grep`, `glob_file_search`, and `read_file` to find the relevant code. Do not guess.
3. **Hypothesize** — state one concrete hypothesis and the evidence for it.
4. **Verify** — read the surrounding code, check diagnostics (`read_diagnostics`), and run a focused test or command if it will confirm the hypothesis.
5. **Fix the cause** — change the smallest amount of code that fixes the root cause. Avoid drive-by refactors.
6. **Prove it** — re-run the failing case or the relevant test. Summarize what was wrong and why the fix works.

Never claim a fix works without checking. If you cannot reproduce, say so and ask for a minimal example.
