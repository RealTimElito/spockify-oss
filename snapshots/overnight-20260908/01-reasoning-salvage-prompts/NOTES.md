# 01 — reasoning salvage + prompt/digest tightening

## Changes
1. **lab loop**: `usable_reply()` salvages plan JSON / DONE text from reasoning when content empty (DeepSeek-R1 orch symptom).
2. **lab prompts**: output contract — JSON/DONE must be in final content; review prefers done when digests suffice.
3. **digests**: extract FINDINGS/ARTIFACTS sections for cleaner orch merge.
4. **midthought**: min prompt 40 chars + ≥6 words; richer spawn hint; OUTCOME in merge digests; merge prompt leads with recommendation.
5. **parallel_agents**: SPAWN worker temp 0.35; DONE/FINDINGS system prompt; salvage reasoning_content when content empty.

## Expected delta
- Fewer empty-plan / empty-digest rounds on twin lab-orchestrator (R1).
- Cleaner review inputs → fewer replan churn rounds.
- Higher SPAWN child digest structure for merge quality.
