# AI Git attribution

Human approval and transparent AI attribution are non-negotiable for Spockify
agent work that lands in Git.

This document is the **convention**, not a full audit ledger. It does not
claim automated enforcement on every commit path.

## Rules

1. **Human author stays the Git author** for commits a person approves and
   lands. Agents must not silently impersonate a human contributor.
2. **AI assistance is visible** when an agent drafted, edited, or proposed the
   change that was committed.
3. **Approval is explicit** — the human reviews the diff (and tests when
   relevant) before the commit or merge ships.

## Recommended trailer

Append a standard Git trailer after the subject/body:

```text
Co-authored-by: Spockify <spockify@users.noreply.github.com>
```

Notes:

- Use `Co-authored-by` so GitHub and most forges render the AI as a co-author.
- Keep the human as `Author` / committer unless your forge workflow says
  otherwise.
- Optionally add a second line when the assisting model id is useful, e.g.
  `Assisted-by: gpt-oss-20b` (informational; not a forge-standard trailer).

## Message shape

```text
type(optional-scope): imperative subject

Optional short body.

Co-authored-by: Spockify <spockify@users.noreply.github.com>
```

IDE generate-commit-message helpers live in
`extensions/spockify/src/git/commitMessage.ts` (`appendAiCoAuthorTrailer`).
They format messages; they do not replace human review.

## Out of scope (for now)

- Full per-change audit history (request, agent, model, files, tests, reviewer,
  approver, commit/PR ids) — roadmap pillar, not this convention.
- Automatic trailers on every shell `git commit` outside Spockify tooling.
- Claiming “enterprise audit logging” from this convention alone.
