---
title: AI code review
category: methodology
tags: git, github, gh, review, diff, security, attribution
---

# AI code review

Produce an **independent** review of local changes or a GitHub PR using
`git` + `gh` (read-focused). This is advisory text for a human — not a merge
approval and not a signed security audit.

**Forge stance (GitHub-first):** prefer `gh pr view` / `gh pr diff` when a PR
number or URL is given. GitLab / Gitea review APIs are **future**.

Copy this folder into `<cwd>/.spockify/skills/ai-code-review/` (or attach with
`/skill ai-code-review` after it is under `.spockify/skills`) so the coding
harness can load it.

Attribution (SoT): [`docs/AI_GIT_ATTRIBUTION.md`](../../../../docs/AI_GIT_ATTRIBUTION.md).
Forge overview: [`docs/FORGE_GITHUB.md`](../../../../docs/FORGE_GITHUB.md).

## When to use

- “Review this PR”, “review my diff before I open a PR”, “second pair of eyes”
- Security / maintainability pass after implementation (still human-gated)

## Safe defaults

- Read-only by default. Do **not** `gh pr review --approve` or `--request-changes`
  unless the operator explicitly asks to post a GitHub review.
- Do not merge, force-push, or amend.
- Separate **facts from the diff** from **opinions / risk guesses**.
- Never claim G1-09 pentest complete, enterprise audit, or SWE board % from a
  local review.
- Cap large diffs: start with `--stat`, then focus on risky files.

## Recipe — local uncommitted / branch vs base

```bash
git status -sb
BASE="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
BASE="${BASE:-main}"
git fetch origin
git diff --stat "origin/${BASE}...HEAD"
git diff "origin/${BASE}...HEAD"
# Or working tree:
git diff
git diff --cached
```

## Recipe — GitHub PR

```bash
gh pr view PR_NUMBER --json title,body,baseRefName,headRefName,files,url
gh pr diff PR_NUMBER
gh pr checks PR_NUMBER
```

## Review shape

```markdown
## Review summary
One paragraph: what the change does (from evidence).

## Findings
- [critical|high|medium|low|nit] path: issue — why — suggested fix

## Tests / verification
What was (or was not) run. Do not invent green CI.

## Verdict
Approve / request changes / needs human judgment — **advisory only**.
Human merge approval remains required.
```

Look for: incorrect logic, missing tests, secret leakage, unsafe shell,
path traversal, silent behavior changes, and AI attribution gaps on
agent-authored commits (see AI_GIT_ATTRIBUTION).

## How to answer

1. Scope (PR # / branch / working tree) and files touched.
2. Findings ordered by severity; nits last.
3. Explicit **advisory** verdict; do not approve as a human.
4. Offer to draft `gh pr comment` text only if asked — still human-posted
   unless they request the CLI post.

## Out of scope

- Opening the PR (see `pr-generation`) or writing commits
  (`intelligent-commits`).
- Full AI development audit ledger (roadmap pillar; not this skill).
- Independent G1-09 pentest or customer pilot sign-off.
- Non-GitHub forge review CLIs (future).
