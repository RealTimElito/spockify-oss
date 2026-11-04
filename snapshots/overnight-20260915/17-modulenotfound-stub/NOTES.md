# 17 — tip 65 ModuleNotFound stub force + AssertionError room

## Tip 65
- Treat `ModuleNotFoundError` like ImportError in preseed/stub fail paths
- Invent missing-module stub budget **3**; stronger WRITE force nudge
- Looser post-AssertionError cap (tool_i>=3) + quote Exact failure
- Compose tip65b LRU: **~28s** Round 1 after 2 stubs (was tip64 R4 / tip65a soft)

## Do not undo
59 double stub; 58 preseed green.
