---
title: Branch management
category: methodology
tags: git, branch, checkout, worktree, github
---

# Branch management

Create, switch, rename, and clean up **local** branches with `git` only.
When the operator asks to publish a branch for a PR, use `git push -u`
against the configured remotes — do **not** invent remotes or force-push.

**Forge stance (GitHub-first):** this skill is local git. Opening or merging
PRs belongs in the `pr-generation` skill (`gh`). GitLab / Gitea / Forgejo
remotes may already exist; native `glab` / forge APIs are **future** work —
do not invent them here.

Copy this folder into `<cwd>/.spockify/skills/branch-management/` (or attach
with `/skill branch-management` after it is under `.spockify/skills`) so the
coding harness can load it.

Attribution convention (SoT): [`docs/AI_GIT_ATTRIBUTION.md`](../../../../docs/AI_GIT_ATTRIBUTION.md).
Forge overview: [`docs/FORGE_GITHUB.md`](../../../../docs/FORGE_GITHUB.md).

## When to use

- “Make a feature branch”, “switch back to main”, “rename this branch”
- Before commits / PRs when work should not land on the default branch
- Cleaning merged local branches after a human merge

## Safe defaults

- Prefer **suggesting** commands; only run mutating git when the operator
  asks (or clearly wants the branch created now).
- Never `git push --force`, rewrite history, or delete a remote branch
  unless the operator explicitly asks.
- Never commit or open a PR from this skill alone — use
  `intelligent-commits` / `pr-generation` when asked.
- Cap `git branch -vv` / `git log` output so replies stay readable.

## Recipe — inspect

```bash
git status -sb
git branch -vv
git remote -v
git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true
```

## Recipe — create and switch

```bash
# From an up-to-date base (usually main or master)
git fetch origin
git switch -c feature/short-topic origin/main   # or: git checkout -b …
```

Name branches for the change (`fix/…`, `feat/…`, `docs/…`). Avoid spaces.

## Recipe — rename / clean up

```bash
git branch -m old-name new-name
# After the PR is merged upstream and the human confirms:
git switch main
git pull --ff-only
git branch -d feature/short-topic
```

Do not `-D` (force-delete) unless the operator asks and understands unmerged
commits will be dropped locally.

## Optional worktree (same repo, separate tree)

```bash
git worktree list
git worktree add ../repo-feature feature/short-topic
```

Use a worktree when the operator wants parallel checkouts. Do not claim a
full multi-agent worktree product from this skill alone.

## How to answer

1. State current branch, clean/dirty, and tracking remote if any.
2. Propose the exact branch name and base.
3. Run or paste the commands; confirm the new `git status -sb`.
4. Remind: human approval before push / PR / delete-remote.

## Out of scope

- `gh pr create` / review threads (see `pr-generation`, `ai-code-review`).
- GitLab MR / Gitea PR CLIs (future).
- Persistent project-intelligence indexes or automatic issue→branch mapping.
- Claiming enterprise branch-protection or RBAC from local git alone.
