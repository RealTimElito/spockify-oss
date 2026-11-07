---
title: Release notes from tags
category: methodology
tags: git, changelog, release, tags, ide
---

# Release notes from tags

Draft a **changelog / release notes** from local `git log` between tags (or a
tag and `HEAD`). Do **not** call GitHub Releases APIs, uploaders, or signing
services. Do **not** start Win/mac installer or code-signing work from this skill.

Copy this folder into `<cwd>/.spockify/skills/release-notes-from-tags/` (or
attach with `/skill release-notes-from-tags` after it is under `.spockify/skills`)
so the coding harness can load it.

Operator-facing short page: [`docs/RELEASE_NOTES_FROM_TAGS.md`](../../../../docs/RELEASE_NOTES_FROM_TAGS.md).

## When to use

- “What changed since `ide-1.0.2`?”
- Draft GitHub Release body / CHANGELOG section from commits between two refs.
- Summarise `ide-X.Y.Z` or `docker-v*` tag ranges before a human publishes.

## Safe defaults

- Local git only (`tag`, `log`, `describe`, `show`).
- Cap output (`-n`, path filters, `--no-merges` when noise is high).
- Separate **facts from git** from **your grouping / wording**.
- Never rewrite tags, force-push, or sign artifacts unless the operator
  explicitly asks (signing is out of scope here).

## Recipe — list tags

```bash
git tag -l 'ide-*' --sort=-v:refname | head -20
git tag -l 'docker-v*' --sort=-v:refname | head -20
git describe --tags --abbrev=0
```

Spockify IDE releases commonly use `ide-X.Y.Z`. Compose kit tags often use
`docker-v*`. Use whatever tags exist in **this** checkout.

## Recipe — log between refs

```bash
# PREV..NEW  (commits reachable from NEW but not PREV)
git log --no-merges --date=short --format='%h %ad %s' PREV..NEW
git log --no-merges --format='%s' PREV..NEW
git shortlog -sn PREV..NEW
git diff --stat PREV..NEW
```

Examples:

```bash
git log --no-merges --format='%h %s' ide-1.0.3..ide-1.0.4
git log --no-merges --format='%h %s' ide-1.0.4..HEAD
```

If `PREV` is missing (shallow clone / first release), say so and use
`git log -n 50` from `NEW` or `HEAD` instead of inventing history.

## How to draft the notes

1. State the range (`PREV` → `NEW`) and how many commits you used.
2. Group into short sections when useful, e.g. **Added**, **Fixed**, **Changed**,
   **Docs** — derived from subjects / diffs, not guessed product claims.
3. Prefer operator-readable bullets over dumping every SHA; keep notable SHAs
   for risky or large changes.
4. Call out breaking changes or migrate steps only when the log/diff supports them.
5. Offer a paste-ready Markdown block suitable for a Release description.
6. Remind the human to publish / attach binaries; this skill only drafts text.

## Out of scope

- Win/mac code signing, notarization, or App Store / MSIX pipelines.
- Building AppImage/deb or running `make release`.
- Forge issue/PR API enrichment (optional later; local log is enough here).
- Claiming marketing win rates, SWE %, or “enterprise” from release notes.
