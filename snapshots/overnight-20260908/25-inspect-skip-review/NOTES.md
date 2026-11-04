# 25 — skip orch review on inspect/propose digests

## Keep (on top of 24)
When goal is non-pytest inspect/propose (propose/summarize/do not write/…) and
exec digests are DONE with findings and no writes/failures, skip R1 review.

## Live
- micro: ~154s → **~100s** (q10), review skipped
- pytest path unchanged (calc/ledger still bootstrap)

Superseded for WRITE salvage by 26; keep the review-skip logic.
