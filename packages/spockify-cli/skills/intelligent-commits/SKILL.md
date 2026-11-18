---
title: Intelligent commits
category: methodology
tags: git, commit, message, attribution, co-author
---

# Intelligent commits

Suggest a **commit message** from the local working tree only (`git status`,
`git diff`, `git diff --cached`). Do **not** call GitHub, GitLab, Gitea, or
Forgejo APIs. Do **not** invent files or hunks that are not in the diff.

Copy this folder into `<cwd>/.spockify/skills/intelligent-commits/` (or attach
with `/skill intelligent-commits` after it is under `.spockify/skills`) so the
coding harness can load it.

## Relation to the IDE

The Spockify IDE already has **Generate Commit Message**
(`extensions/spockify/src/git/commitMessage.ts`, including
`appendAiCoAuthorTrailer`). This skill is for CLI / harness / chat agents that
only have shell git — **do not** rebuild that UI or claim feature parity with it.

Attribution convention (SoT): [`docs/AI_GIT_ATTRIBUTION.md`](../../../../docs/AI_GIT_ATTRIBUTION.md).

## When to use

- Operator asks for a commit message, “what should I commit?”, or a short
  summary of staged / unstaged work.
- Agent finished edits and needs a human-reviewable message before `git commit`.

## Safe defaults

- Prefer **suggesting** the message; only run `git commit` when the operator
  explicitly asks.
- Never rewrite history, force-push, or amend unless the operator explicitly asks.
- Never put secrets, tokens, or full file dumps in the message.
- Cap diff context (`git diff --stat` first; then focused hunks).

## Recipe — gather local change context

```bash
git status -sb
git diff --stat
git diff --cached --stat
git diff
git diff --cached
git log -n 8 --oneline   # match local message style
```

If nothing is staged and the operator intends a commit of the working tree,
say so and base the message on unstaged `git diff` (or ask them to stage).

## Message shape

Follow [`docs/AI_GIT_ATTRIBUTION.md`](../../../../docs/AI_GIT_ATTRIBUTION.md):

```text
type(optional-scope): imperative subject

Optional short body — why, not a file list.

Co-authored-by: Spockify <spockify@users.noreply.github.com>
```

Rules:

1. Subject: imperative mood, ≤72 chars, no trailing period.
2. Body only when needed (why / breaking / follow-ups) — wrap ~72.
3. When an agent drafted or edited the change, append the
   `Co-authored-by: Spockify <spockify@users.noreply.github.com>` trailer.
   Keep the **human** as Git author unless the forge workflow says otherwise.
4. Optional informational line: `Assisted-by: <model-id>` (not a forge-standard
   trailer).
5. Do not invent changes absent from the diff. Do not strip existing trailers
   the operator already wrote.

## How to answer

1. One-line summary of what the diff actually does (from evidence).
2. Propose the full commit message in a fenced block ready to paste.
3. Note staged vs unstaged if they differ.
4. Remind that **human review / approval** is required before landing the commit.

## Out of scope

- Forge PR/MR creation, issue linking APIs, or remote review threads.
- Commit splitting across unrelated hunks (separate skill / later work).
- Replacing the IDE Generate Commit Message command surface.
- Claiming a full AI development audit ledger from the trailer alone.
