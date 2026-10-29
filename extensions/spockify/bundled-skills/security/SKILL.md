---
title: Security review
category: security
tags: [security, review]
---
# Security review

Review the relevant code for security issues. Prioritize real risks over style.

Check for:
- Injection (SQL, command, template, path traversal)
- Authn/authz gaps and insecure direct object references
- Secret handling (hard-coded keys, logging tokens, insecure storage)
- Unsafe deserialization and prototype pollution
- XSS / CSRF where web-facing
- Dependency and supply-chain red flags in the changed files
- Overly broad permissions or missing input validation

Report each finding with severity, location, impact, and a concrete remediation. If nothing notable, say so clearly.
