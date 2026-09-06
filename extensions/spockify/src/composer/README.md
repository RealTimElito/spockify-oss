# Composer / shadow workspace notes

## Defaults

- `spockify.composer.shadowWorkspace` **default true**
- `spockify.composer.reviewMode` **default `panel`** — open Diff Review + stage Composer tree (no modal picker)
- `spockify.composer.verifyAfterTurn` **default false** — verify via tree action, not a post-turn QuickPick
- Durable path: `<workspace>/.spockify/shadow/<sessionId>/`
- Temp fallback only when no workspace folder is open

## Accept UX (Cursor-like)

After a turn with patches:

1. Stage pending files in the Composer sidebar (inline Accept / Diff / Discard)
2. View title: Accept all · Diff Review · Discard all (when pending)
3. Default `reviewMode=panel` opens the Diff Review webview (Accept all / per-file / Discard / Open Diff)
4. Revise turns keep OpenAI-shaped `assistant.tool_calls` + `role:tool` in session history

Legacy modal picker: set `spockify.composer.reviewMode` to `prompt`.

## SSH

Shadow trees are created with `workspaceFolders[0].uri.fsPath`. On Remote SSH that is the **remote** path, so shadows land on the remote disk under `.spockify/shadow/` (also ignored by default codebase indexing).

If remote disk is constrained, disable shadow (`spockify.composer.shadowWorkspace=false`) and accept that Composer Accept writes directly via ApplyService.

## Commands

- `spockify.composer.verify` — terminal allowlist verify
- `spockify.composer.listShadows` / `spockify.composer.gcShadows`
- `spockify.composer.acceptAllPending` / `diffReviewPending` / per-file Accept·Diff·Discard
- Diff Review panel on Accept (default)
