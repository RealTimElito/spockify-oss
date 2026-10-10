# 07 — tip 55 nested-fence WRITE extract + glued markers

## Tip 55 (on tip 54)
- `_extract_balanced_fence_writes`: last line-only ``` before DONE closes outer body
- `_normalize_harness_text`: un-glue `line.WRITE:` / `.RUN:` glitches
- Fixes markdown docs with inner ```python blocks; rate pytest still **3 passed**

## Live (compose careful)
- tip54d docs: **~18s** wall, API.md **711 bytes**
- tip54-rate: **~16s**, pytest green
