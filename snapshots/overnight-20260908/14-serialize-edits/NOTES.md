# 14 — serialize multi-file edit tasks + shorter orch think

Keeps 12+13 (pytest harness gate, WRITE/JSON fixes).

## Live
- `14-shop-serialize-warm` quality **10** · ~202s · WRITE both files · `4 passed` · single-round stop
- Orch emitted one sequential task (no parallel race); gate satisfied via harness pytest_passed

## Also
- Shop eval timeout 600s (R1-70b cold start can exceed 400s)
