---
category: methodology
tags: methodology, index, routing
---

# Skill index (router)

Find an existing playbook before writing your own. Use `eval_search_skills <keyword or weakness class>`, then `eval_activate_skill <id>`. Skills are reference; the broker still gates every action, and you may only name in-scope assets and weakness classes from `eval_scope`.

Rough categories in the pool (search to find exact ids):

- Web app: `sqli-*`, `xss-*`, `ssrf-*`, `ssti-*`, `xxe-*`, `csrf-*`, `idor-*`, `path-traversal-*`, `deserialization-*`, `request-smuggling`, `cors-*`, `open-redirect`, `upload-*`, `prototype-pollution*`, `web-cache-*`, `clickjacking`
- API / auth: `api-*`, `jwt-*`, `oauth-*`, `saml-*`, `auth*`, `graphql-*`
- Network / AD / lateral: `active-directory-*`, `*kerberos*`, `ntlm-relay-*`, `network-protocol-attacks`, `tunneling-and-pivoting`, `*-lateral-movement`, `unauthorized-access-common-services`
- Priv-esc / OS: `*-privilege-escalation`, `*-security-bypass`, `container-escape-*`, `sandbox-escape-*`
- Binary / exploit analysis: `stack-overflow-and-rop`, `heap-exploitation`, `format-string-*`, `kernel-exploitation`, `browser-exploitation-*`, `binary-protection-bypass`, `arbitrary-write-to-rce`
- Crypto: `rsa-*`, `hash-*`, `lattice-*`, `symmetric-*`, `classical-cipher-*`
- Mobile: `android-*`, `ios-*`, `mobile-ssl-pinning-bypass`
- Cloud / infra: `kubernetes-*`, `container-*`, `dependency-confusion`, `insecure-source-code-management`
- Recon / methodology: `recon-*`, `attack-surface-mapping`, `api-recon-*`
- Reporting / process: `roe-rules`, `finding-schema`, `finding-writeup`, `cwe-mapping`, `scoping-checklist`, `evidence-handling`

Workflow: `eval_scope` → `eval_search_skills` for the technique → `eval_activate_skill` → inspect the tree with the read/search tools → `eval_submit_finding` / `eval_submit_report`.
