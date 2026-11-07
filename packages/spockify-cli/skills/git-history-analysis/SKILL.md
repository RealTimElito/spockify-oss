---
title: Git history analysis
category: methodology
tags: git, blame, log, history, review
---

# Git history analysis

Use local `git` only (`log`, `blame`, `show`, `diff`, `log -S` / `-G`). Do **not** call GitHub, GitLab, Gitea, or Forgejo APIs. Do **not** build or claim a persistent project-intelligence index — answer from the current checkout and the commands below.

Copy this folder into `<cwd>/.spockify/skills/git-history-analysis/` (or attach with `/skill git-history-analysis` after it is under `.spockify/skills`) so the coding harness can load it.

## When to use

- Why did this file / function change?
- Who last touched a line, and in which commit?
- When did a behaviour or string appear or disappear?
- Summarise recent history for a path before editing or reviewing.

## Safe defaults

Prefer read-only git. Never rewrite history, force-push, or amend unless the operator explicitly asks. Cap output (`-n`, path filters) so replies stay readable.

## Recipe — who changed a line

```bash
git blame -w -C -C -- PATH
git blame -L START,END -w -- PATH
git log -L :function_name:PATH
```

Follow interesting SHAs with `git show --stat SHA` and `git show SHA -- PATH`.

## Recipe — why a path evolved

```bash
git log --follow --date=short --format='%h %ad %an %s' -- PATH
git log -p --follow -n 20 -- PATH
git log --diff-filter=A --summary -- PATH   # first appearance
```

## Recipe — find when behaviour landed

```bash
git log -S 'symbol_or_string' --oneline -- PATH
git log -G 'regex' --oneline -- PATH
git log --all --full-history -- PATH
```

## Recipe — recent project context (scoped)

```bash
git log -n 30 --oneline --decorate
git log -n 20 --format='%h %an <%ae> %s' -- PATH_OR_DIR
git shortlog -sn -n 20 -- PATH_OR_DIR
```

## How to answer

1. State the question you are answering (path, lines, or behaviour).
2. Cite SHAs, dates, and author names from local git output.
3. Quote only the relevant hunks; do not dump whole files.
4. Separate **facts from git** from **your inference**.
5. If history is missing (shallow clone, no `.git`), say so and stop — do not invent history.
6. For AI-authored commits, note trailers such as `Co-authored-by:` when present; do not strip or invent attribution.

## Out of scope

- Forge issue/PR APIs, webhooks, or remote review threads.
- Persistent architecture / convention databases.
- Secret recovery from history (point the operator at a secrets scanner; do not exfiltrate credentials into chat).
