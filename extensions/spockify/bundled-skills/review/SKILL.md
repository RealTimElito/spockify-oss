---
title: Code review
category: engineering
tags: [review, quality]
---
# Code review

Review the requested code (or the current diff) with this checklist. Lead with the most important findings.

- **Correctness** — logic errors, off-by-one, unhandled cases, race conditions
- **Security** — injection, authz gaps, secret leakage, unsafe deserialization
- **Error handling** — swallowed errors, missing fallbacks, bad error messages
- **API / contracts** — breaking changes, unclear types, missing validation
- **Tests** — missing coverage for the changed behavior
- **Clarity** — names, structure, comments that explain why (not what)

Format findings as:
- **Severity** (blocker / should-fix / nit)
- **Where** (file:line)
- **What** and **why**
- **Suggested fix** (short)

End with a one-line verdict: approve, approve with nits, or request changes.
