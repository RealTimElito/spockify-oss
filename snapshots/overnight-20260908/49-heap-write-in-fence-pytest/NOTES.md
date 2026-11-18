# 49 — heap invent + WRITE-in-fence + keep pytest after WRITE

## Keep (on top of 47)
1. New harder invent `lab_heap_eval.py` (MinHeap).
2. Invent: skip README cat when asserts listed; filter+nudge README cats.
3. Salvage WRITE buried inside ``` fences (rate glitch).
4. Do not filter preseed pytest away when the turn includes WRITE.

## Live
- flatten/anagrams **q10 ~12s**; invent **~14s**; heap-boot **~31s**; heap-noboot **~116s**
- ledger **~30s**; queue **~28s**; rate q10 (~293s twin/model thrash variance)

## Do not undo
47 / 46 / 44 / 42 / 34.
