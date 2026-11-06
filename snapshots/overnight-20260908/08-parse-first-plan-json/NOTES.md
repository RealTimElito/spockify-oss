# 08 — parse_plan uses first valid JSON object

## Problem (07-bugfix)
Orch streamed multiple JSON plans in one reply; greedy `{…}` match failed →
empty tasks → false stop (quality 0).

## Fix
parse_plan via `_extract_json_blob` / raw_decode — first object with status.
