# Forge essentials (GitHub-first)

Scoped **§8 Git Intelligence** helpers for branch → commit → PR → review.
This is **not** a multi-forge product, marketplace, or enterprise RBAC plane.

## Stance

| Forge | Status |
|-------|--------|
| **GitHub** | Supported via local `git` + [`gh`](https://cli.github.com/) |
| GitLab | Future (issues / MRs / `glab`) |
| Gitea / Forgejo | Future (self-hosted) |

Human approval and transparent AI attribution remain non-negotiable:
[`AI_GIT_ATTRIBUTION.md`](AI_GIT_ATTRIBUTION.md).

## Skills (CLI / harness)

Copy a folder into `<cwd>/.spockify/skills/<id>/` (or attach with `/skill`)
so `runHarness` can load it. Frontmatter uses `title` / `category` / `tags`.

| Skill | Path | Role |
|-------|------|------|
| Branch management | `packages/spockify-cli/skills/branch-management/` | Local create / switch / rename / cleanup |
| Intelligent commits | `packages/spockify-cli/skills/intelligent-commits/` | Message from local diff + Co-authored-by |
| PR generation | `packages/spockify-cli/skills/pr-generation/` | Draft / `gh pr create` |
| AI code review | `packages/spockify-cli/skills/ai-code-review/` | Advisory review from `git` / `gh pr diff` |
| Git history analysis | `packages/spockify-cli/skills/git-history-analysis/` | Local `log` / `blame` |
| Release notes from tags | `packages/spockify-cli/skills/release-notes-from-tags/` | Local tag ranges |

IDE Generate Commit Message already exists
(`extensions/spockify/src/git/commitMessage.ts`); these skills cover CLI /
harness agents that only have shell.

## Operator quick path (GitHub)

```bash
git fetch origin
git switch -c feat/short-topic origin/main
# … implement, test …
# commit with human review + Co-authored-by trailer when AI assisted
git push -u origin HEAD
gh pr create --title "…" --body "…"
# optional advisory review
gh pr diff
```

## Still open (honest)

- Native GitLab / Gitea / Forgejo CLIs and webhooks
- Full AI development audit ledger (request → agent → model → tests → approver)
- PR conversation loops, conflict resolution, issue-to-PR automation
- Enterprise RBAC, marketplace, G8 customer pilot, independent G1-09 pentest

Do not describe this page as “forge complete” or “enterprise Git.”
