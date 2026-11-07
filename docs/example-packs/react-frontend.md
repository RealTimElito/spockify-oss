# React developer pack (template)

Drop-in outline for a React / TypeScript UI workspace. Split into separate
`.spockify/skills/<id>/SKILL.md` files when you want attachable skills — this
file is a template, not an installed marketplace pack.

## Suggested skill ids

| Id | Role |
|----|------|
| `react-ui-implementer` | Components, hooks, routing, state |
| `react-design-system` | Tokens, existing primitives, spacing/type |
| `react-browser-tester` | Playwright/Cypress or project browser checks |
| `react-a11y-reviewer` | Labels, focus, keyboard, contrast |
| `react-perf-analyser` | Re-renders, bundle weight, list virtualisation |

## Shared conventions (edit for the repo)

- Prefer existing component library and folder layout.
- Keep first-viewport / product UI rules the project already uses.
- Run the project’s lint and unit/browser targets that already exist.
- Human approval before push or release.
- Transparent AI Git attribution when the agent authors commits
  (see [`../AI_GIT_ATTRIBUTION.md`](../AI_GIT_ATTRIBUTION.md)).

## Sample SKILL.md frontmatter

```yaml
---
title: React UI implementer
category: methodology
tags: react, frontend, typescript
---
```

## Sample body bullets for `react-ui-implementer`

1. Reuse existing primitives before adding new ones.
2. Prefer accessible native controls; wire labels and focus order.
3. Colocate tests the way neighbouring features already do.
4. Avoid new global CSS frameworks unless the repo already uses them.

## Sample body bullets for `react-a11y-reviewer`

1. Keyboard reachability and visible focus.
2. Meaningful names for buttons, links, and form fields.
3. Colour contrast and non-colour status cues.

## Not included

- Hosted pack install, billing, or remote catalog APIs.
- Automatic design-tool sync or Figma marketplace plugins.
