# 09 — tip 57 nested-fence early-stop

## Tip 57 (on tip 55)
- `_has_open_code_fence` tracks WRITE outer fences so nested ```python does not
  early-stop mid-docs (naive ``` count % 2 went even after the inner close).

## Do not undo
55 nested WRITE extract; 54 docs quality gate.
