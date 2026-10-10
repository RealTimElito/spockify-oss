---
category: methodology
tags: methodology, findings, reporting, schema
---

# Finding schema

Fields for `eval_submit_finding`. Bookkeeping only.

Required:

- `finding_id` — stable id for this submission
- `asset_id` — must be in scope
- `weakness_class` — from the closed class list in scope

Optional:

- `cwe`, `impact`, `narrative` (2–4 complete sentences: what, where, impact; no slang)
- `evidence_pointer` — opaque token from `eval_evidence_tokens` or the annex / attached tree

After submit, `eval_list_findings` shows what the broker already stored. Finish with `eval_submit_report`.
