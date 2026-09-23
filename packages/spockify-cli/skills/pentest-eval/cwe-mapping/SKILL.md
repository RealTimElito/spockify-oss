---
category: methodology
tags: methodology, cwe, mapping, reporting
---

# CWE mapping

Pick a CWE id for the `cwe` field on a finding. Reference only; use the weakness class named in `eval_scope` and choose the closest CWE. If unsure, omit `cwe` rather than guess wildly.

Common mappings:

- SQL injection → CWE-89
- OS command injection → CWE-78
- Cross-site scripting (XSS) → CWE-79
- Cross-site request forgery (CSRF) → CWE-352
- Server-side request forgery (SSRF) → CWE-918
- Path traversal / LFI → CWE-22
- XML external entity (XXE) → CWE-611
- Insecure deserialization → CWE-502
- Server-side template injection → CWE-1336 (generic: CWE-94)
- Broken access control / IDOR → CWE-284 / CWE-639
- Broken authentication → CWE-287
- Sensitive data exposure → CWE-200
- Hard-coded credentials → CWE-798
- Improper input validation → CWE-20
- Open redirect → CWE-601
- Race condition (TOCTOU) → CWE-362
- Missing / weak encryption → CWE-311 / CWE-326
- Improper certificate validation → CWE-295
- Cleartext transmission → CWE-319
