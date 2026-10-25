# 14 — tip 62 WRITE observation sanitize + minstack invent

## Tip 62 (on tip 61)
- `sanitize_write_body` strips `N passed in`, `$ pytest`, SHELL OBSERVATIONS junk
  pasted into WRITE fences (caused SyntaxError thrash on minstack tip62a)
- Compose tip62b minstack: **~35s** Round 1, 1 passed

## Do not undo
33 empty write reject; 42 double-fence.
