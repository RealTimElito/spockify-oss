# 41 — preseed skip test cats when assert hints present

## Keep (on top of 39)
When invent instructions include "Key asserts from tests", drop `cat test_*.py` from preseed (asserts already listed; pytest ImportError still preseeded).

## Do not undo
23 / 27 / 29 / 31 / 34 + 39.
