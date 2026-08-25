# ApplyService (`src/apply`)

Shared apply/diff engine for Chat, Composer, Ctrl+K, and agents (WS-CLONE-K). Writers use `vscode.workspace.fs` so remote (SSH) workspace URIs work.

## Types (§6.4)

- `ApplyPatchRequest` — `files[]` with `path`, optional `nextContent` or `unifiedDiff`, plus `source`.
- `ApplyResult` — `applied` / `rejected` paths (and hunk ids when partial apply), optional `checkpointId`.
- `DiffPreview` — per-file `unifiedDiff`, `hunks`, `currentContent`, `nextContent`.
- `HunkId` — `` `${path}#${index}` ``.

## API

```ts
import { createApplyService, parsePatchText } from './apply';

const apply = createApplyService(context);

const req = parsePatchText(assistantText, 'composer');
const preview = await apply.preview(req);
await apply.apply(req); // all hunks

await apply.apply(req, { hunks: ['src/foo.ts#0'] }); // accept one hunk

apply.onApplied((result) => { /* checkpoint hook */ });
await apply.undoLast();
```

### Parsing

| Module | Role |
|--------|------|
| `parse.ts` | Fenced ```path blocks, ```diff fences, bare unified diff |
| `diff.ts` | Build unified diff from old/new content |
| `hunks.ts` | Parse hunks, apply accept/reject subset |

`parsePatchText(text)` merges fenced and bare diff segments; duplicate paths are merged (later wins).

### Commands

- `registerApplyCommands` — registers `spockify.applyPatches`, `spockify.applyUndo` (Ctrl+Alt+Z when `spockify.apply.canUndo`).
- Post-apply toast offers **Undo** / **Checkpoints** (`notifyApplySuccess`).
- `commands/apply.ts` — `spockify.apply` (paste patch or Ghost selection fallback).

## Tests

From `extensions/spockify`:

```bash
npx tsc -p tsconfig.apply.json && node --test src/apply/test/run-tests.mjs
```

Fixtures live in `src/apply/test/fixtures/`. Undo last + canUndo covered in the mock-FS suite.
