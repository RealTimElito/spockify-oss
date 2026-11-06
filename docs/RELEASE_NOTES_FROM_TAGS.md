# Release notes from tags (local git)

Draft changelogs from **local** `git log` between tags or a tag and `HEAD`.
This page is the short operator recipe; agents can also load the skill
[`packages/spockify-cli/skills/release-notes-from-tags/SKILL.md`](../packages/spockify-cli/skills/release-notes-from-tags/SKILL.md).

It does **not** cover Win/mac signing, notarization, or shipping installers.

## Commands

```bash
git tag -l 'ide-*' --sort=-v:refname | head -20
git log --no-merges --date=short --format='%h %ad %s' PREV..NEW
git diff --stat PREV..NEW
```

IDE tags are usually `ide-X.Y.Z`. Compose kit tags are often `docker-v*`.

## Draft shape

```markdown
## ide-X.Y.Z

### Added
- …

### Fixed
- …

### Changed
- …
```

Group from commit subjects and the diff — do not invent features. Human review
before publishing a GitHub Release or updating downloads.
