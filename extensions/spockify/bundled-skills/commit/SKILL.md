---
title: Commit messages
category: git
tags: [git, commit]
---
# Commit messages

Write a commit message for the current changes. Prefer the fuller CLI skill
`intelligent-commits` when available. Attribution SoT:
`docs/AI_GIT_ATTRIBUTION.md`. Do not rebuild the IDE Generate Commit Message UI.

1. Run `git status` and `git diff` (or use the git tools) to see exactly what changed.
2. Subject line: imperative mood, ≤72 chars, no trailing period. Example: `Fix model list falling back to catalog`.
3. Body (if needed): what changed and why, not a file list. Wrap at ~72.
4. Mention breaking changes or follow-ups explicitly.
5. When an agent drafted the change, append:
   `Co-authored-by: Spockify <spockify@users.noreply.github.com>`

Do not invent changes that are not in the diff. Do not include secrets.
