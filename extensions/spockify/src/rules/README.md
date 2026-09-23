# WS-CLONE-H — Rules / Memories

## Merge order

1. **Global** — `~/.spockify/rules.md`
2. **User** — extension `globalStorage/user-rules.md`
3. **Project** — `.spockify/rules/**` files, then `.spockify/rules`, `.cursorrules`

Higher layers are appended after lower ones in the prompt (project last).

## Commands

- `spockify.rules.show` — open effective merged rules
- `spockify.rules.editUser` — set user rules
- `spockify.memories.add` / `spockify.memories.list`

## Acceptance

- [x] Nested `.spockify/rules/**` merge
- [x] `.cursorrules` still works via `loadProjectRules`
- [x] Memories inject when `buildAtContext({ context })` is used
- [ ] Chat send path passes `context` (wire in extension/chat)

## API

- `getEffectiveRules(context?)`
- `getMemories` / `addMemory` / `formatMemoriesForPrompt`
- `buildAtContext` — optional `codebaseHits` for `@codebase`
