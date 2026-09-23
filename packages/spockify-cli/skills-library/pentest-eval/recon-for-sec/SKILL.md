---
name: recon-for-sec
description: >-
  Entry P1 category router for reconnaissance and methodology. Use when mapping
  scope, drawing an attack surface from one application, discovering assets,
  fingerprinting technology, building endpoint inventory, and choosing the
  first high-value security testing path.
---

# Recon and Methodology Router

This is the starting router for new targets and unknown attack surfaces.

## When to Use

- You just received a new target and do not yet know what to test first
- You need to begin by drawing the surface from the application, then asset discovery, fingerprinting, and test-route planning
- You want to build follow-up testing on structured methodology instead of random payload enumeration

## Skill Map

- [Attack Surface Mapping](../attack-surface-mapping/SKILL.md) — from one URL / one app, draw hosts, APIs, keys, and the object graph
- [Recon and Methodology](../recon-and-methodology/SKILL.md)
- [Insecure Source Code Management](../insecure-source-code-management/SKILL.md) — .git/.svn/.hg exposure detection
- [Dependency Confusion](../dependency-confusion/SKILL.md) — Supply chain reconnaissance for internal package names

## Recommended Flow

1. Confirm in-scope assets and target type
2. Draw the surface from the application: [attack-surface-mapping](../attack-surface-mapping/SKILL.md)
3. Route the inventory to [api-sec](../api-sec/SKILL.md), [auth-sec](../auth-sec/SKILL.md), [injection-checking](../injection-checking/SKILL.md), or [business-logic-vuln](../business-logic-vuln/SKILL.md)