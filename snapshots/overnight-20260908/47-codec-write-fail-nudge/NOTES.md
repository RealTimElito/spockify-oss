# 47 — codec invent + WRITE fail nudge

## Keep (on top of 46)
1. New harder invent `lab_codec_eval.py` (run-length encode/decode; `z12` multi-digit).
2. After empty-body / diff-rejected WRITEs, append harness note to re-emit full file.
3. Queue multi-file fix stays a good harder regress (`lab_queue_eval.py`).

## Live
- codec-boot **q10 ~32s**; queue **~31s**; invent **~14s**; rpn **~15s**; rate **~44s**
- parens **~106s** q10 (variance); docs ~12s; minstack ~19s

## Do not undo
46 / 44 / 42 / 34 foundation.
