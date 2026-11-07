---
title: PR generation
category: methodology
tags: git, github, gh, pull-request, pr, attribution
---

# PR generation

Draft and (when asked) open a **GitHub** pull request with local `git` + the
GitHub CLI (`gh`) only. Prefer `gh pr create` with a HEREDOC body.

**Forge stance (GitHub-first):** document and automate GitHub. GitLab merge
requests, Gitea/Forgejo PRs, and non-`gh` forge APIs are **future** — say so
if the remote is not GitHub; do not invent `glab` workflows here.

Copy this folder into `<cwd>/.spockify/skills/pr-generation/` (or attach with
`/skill pr-generation` after it is under `.spockify/skills`) so the coding
harness can load it.

Attribution (SoT): [`docs/AI_GIT_ATTRIBUTION.md`](../../../../docs/AI_GIT_ATTRIBUTION.md).
Forge overview: [`docs/FORGE_GITHUB.md`](../../../../docs/FORGE_GITHUB.md).

## When to use

- “Open a PR”, “write a PR description”, “push this branch and create a PR”
- Summarising commits / diff for a human to paste into GitHub

## Prerequisites

```bash
command -v gh
gh auth status
git remote -v
git status -sb
```

If `gh` is missing or unauthenticated, draft the title/body for the human and
stop — do not scrape passwords or tokens.

## Safe defaults

- Human **reviews** the diff and PR body before merge; agents do not self-merge
  unless the operator explicitly asks.
- Prefer `--draft` when the operator has not said the PR is ready to review.
- Never `git push --force` to a shared branch.
- Never put secrets, full dumps, or invented SWE % / “enterprise” claims in the body.
- Cap `git log` / `git diff --stat` context.

## Recipe — gather context

```bash
git fetch origin
git status -sb
git branch -vv
BASE="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
BASE="${BASE:-main}"
git log --oneline "origin/${BASE}..HEAD"
git diff --stat "origin/${BASE}...HEAD"
```

If the branch has no upstream yet:

```bash
git push -u origin HEAD
```

## Recipe — create with gh

```bash
gh pr create --title "type(scope): short imperative subject" --body "$(cat <<'EOF'
## Summary
- What changed and why (from the diff — do not invent)

## Test plan
- [ ] How a human can verify

EOF
)"
```

Optional: `--draft`, `--base main`, `--assignee @me`.

Match title style to recent commits. When an agent authored the change, keep
the human as Git author and ensure commits follow
[`docs/AI_GIT_ATTRIBUTION.md`](../../../../docs/AI_GIT_ATTRIBUTION.md)
(`Co-authored-by: Spockify <spockify@users.noreply.github.com>`). Mention AI
assistance in the PR body only when useful — do not silently impersonate a
human reviewer or approver.

## How to answer

1. State base ← head, commit count, and whether the branch is pushed.
2. Propose title + body in a fenced block (ready to paste).
3. Run `gh pr create` only when asked; print the PR URL.
4. Remind: human approval before merge; CI must be interpreted honestly.

## Out of scope

- Independent AI review (see `ai-code-review`).
- GitLab / Gitea / Forgejo native CLIs (future).
- Auto-merge, branch-protection admin, or marketplace bots.
- Terminal Bench, Hub Lite boards, or readiness gate greenwash in PR text.
