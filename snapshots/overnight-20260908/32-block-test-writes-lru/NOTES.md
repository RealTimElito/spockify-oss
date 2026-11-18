# 32 — block test_*.py WRITEs + LRU harder eval

## Keep (on top of 31)
1. `block_tests` on apply_writes unless goal explicitly asks to write tests
2. Exec prompt: don't WRITE test_*.py for fix goals
3. New `lab_lru_eval.py` — eviction + overwrite refresh

## Live
- LRU **q10 ~27s**
