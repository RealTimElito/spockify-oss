# 04 — tip 52 exec open-fence gate + Cursor HUD

## Tip 52 (on tip 51)
- `exec_stream_should_stop` refuses open ``` fences (odd fence count)
- Also refuses WRITE+DONE when all write bodies are empty/whitespace
- Keeps tip 50 loop-stop (≥3 DONE) and tip 51 orch early-stop

## Cursor-parity
- Ctrl+K: widget phase + status bar show **Generating…** while streaming
- CLI: forward `spockify_agents` → spinner `Spawn · n/m` / Merging…
- IDE chat: composer hint for pending file review Keep/Undo keys

## Tests
- lab-agents unit: open-fence + empty-body cases; suite green
