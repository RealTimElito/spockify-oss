# Inline edit (Ctrl+K)

Cursor-style **selection edit**: prompt → **streaming preview** (chat SSE; Ghost edit fallback) → Accept / Reject / Follow-up.

Command id: `spockify.inlineEdit` (keybinding: **Ctrl+K** / **Cmd+K** when `editorTextFocus && !inlineEditIsVisible && !suggestWidgetVisible`).

## Flow

1. Select code in the active editor, or place the cursor on a line (empty selection expands to that **whole line**).
2. Run **Spockify: Inline Edit** or **Ctrl+K**.
3. Enter a natural-language instruction.
4. The extension **streams** a live **in-place** preview in the same editor (red removed / green added lines; no side-by-side diff tab). Progress is **cancellable**.
5. Choose **Accept** (keeps proposed), **Reject** (restores original), or **Follow-up edit**.

## Commands

| Command | Id |
|--------|-----|
| Start inline edit | `spockify.inlineEdit` |
| Accept preview | `spockify.inlineEdit.accept` |
| Reject preview | `spockify.inlineEdit.reject` |
| Follow-up on same range | `spockify.inlineEdit.followUp` |

While a preview is active, context key `spockify.inlineEditPreviewActive` is `true`.

## Acceptance criteria (WS-CLONE-C)

- [x] **Select → Ctrl+K → instruction** opens the prompt and calls edit with project rules when present.
- [x] **Empty selection**: cursor on a line expands to that line’s text before prompting (documented behavior).
- [x] **Preview before apply**: interleaved red/green lines written **in-place** in the same editor (Cursor-style); Accept keeps proposed, Reject restores; Accept via **Ctrl+Enter** / Esc / overlay buttons (non-blocking).
- [x] **Streaming preview**: tokens paint into the in-place preview as they arrive (~32ms coalesce); cancel aborts and restores original; falls back to non-stream Ghost edit if SSE fails.
- [x] **Accept** keeps the proposed text (strips interleaved red lines).
- [x] **Reject** restores the original selection text.
- [x] **Follow-up** allows another instruction on the **same range**; selection for the model is the **previous proposal**, not yet applied text.
- [x] **Command id** remains `spockify.inlineEdit`; existing Ctrl+K keybinding unchanged.
- [x] Errors surface in Output → Spockify and user notifications; empty model output does not apply.

## Layout

- `session.ts` — range resolution, active session, context key
- `preview.ts` — decorations + diff preview
- `streamEdit.ts` — chat SSE edit + fence strip + Ghost fallback
- `widgetPanel.ts` — editor Ctrl+K companion webview (split / float card)
- `terminalOverlay.ts` + `terminalOverlayHtml.ts` — terminal Ctrl+K floating card (workbench inject)
- `terminalInlineEdit.ts` — terminal Ctrl+K (overlay → panel fallback)
- `register.ts` — command registration and orchestration
- `../commands/inlineEdit.ts` — thin re-export for `extension.ts`
