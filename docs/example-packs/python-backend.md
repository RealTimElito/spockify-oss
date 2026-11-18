# Python backend developer pack (template)

Drop-in outline for a Python API / service workspace. Turn sections into separate
`.spockify/skills/<id>/SKILL.md` files if you want attachable skills — this file
itself is a template, not an installed marketplace pack.

## Suggested skill ids

| Id | Role |
|----|------|
| `py-api-implementer` | Implement FastAPI/Flask/Django endpoints and models |
| `py-postgres-tools` | Migrations, queries, indexes, connection hygiene |
| `py-api-tester` | pytest / httpx / contract tests |
| `py-security-reviewer` | AuthZ, secrets, injection, dependency hygiene |
| `py-docs-generator` | OpenAPI notes, README module sections |
| `py-ci-cd` | GitHub Actions / forge CI job shapes |

## Shared conventions (edit for the repo)

- Prefer the project’s existing package layout and test runner.
- Run the smallest relevant test target before claiming done.
- Never commit secrets; use env / secret stores.
- Human approval before push, release, or production migrate.
- Transparent AI Git attribution when the agent authors commits
  (see [`../AI_GIT_ATTRIBUTION.md`](../AI_GIT_ATTRIBUTION.md)).

## Sample SKILL.md frontmatter

```yaml
---
title: Python API implementer
category: methodology
tags: python, api, backend
---
```

## Sample body bullets for `py-api-implementer`

1. Read existing routers, models, and test layout before writing.
2. Match typing, lint, and formatter already used in-tree.
3. Add or update tests next to the change.
4. Document new env vars in the project README or `.env.example` only.

## Sample body bullets for `py-security-reviewer`

1. Check authn/authz on new routes.
2. Flag raw SQL, unsafe deserialization, and secret-shaped literals.
3. Prefer dependency updates that the operator already tracks; do not force major bumps silently.

## Not included

- Hosted pack install, billing, or remote catalog APIs.
- Automatic MCP marketplace wiring.
