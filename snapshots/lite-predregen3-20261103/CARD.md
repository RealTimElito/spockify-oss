# Lite pred-regen×3 — malformed patch-apply residuals

- IDs: `django__django-12113`, `django__django-12184`, `sphinx-doc__sphinx-8506`
- Driver: `@spockify/harness` `runHarness` (think=low) · model `gpt-oss-20b`
- Host: Spock · Hub auth: **none**
- Preds: `bench-out/lite-predregen3-20261103-lite-predregen3/preds.json`
- Eval: `swebench.harness` · run_id `lite-predregen3-20261103-lite-predregen3`

## Results (3/3 completed)

| ID | Pred paths | Outcome |
|----|------------|---------|
| django__django-12113 | `django/db/backends/sqlite3/creation.py` | **resolved** |
| django__django-12184 | `django/urls/resolvers.py` | unresolved |
| sphinx-doc__sphinx-8506 | `sphinx/domains/std.py` | **resolved** |

- Slice: **2/3 resolved**, 0 errors, 0 empty
- Combined board after merge: **70/300 (23.3%)** completed-denominator (was **68/296** + 3 patch-apply)
- Per-id cards: `snapshots/harness-swe-runHarness-20261103-lite-predregen3-*/CARD.md`
- Do **not** cite as a fresh full-board harness %; only these 3 IDs were regenerated.
