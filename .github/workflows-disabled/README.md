# Enabling CI

`publish-images.yml` lives here (not under `.github/workflows/`) so the repo could
be pushed with a token that lacks the `workflow` OAuth scope.

To enable it, move it into `.github/workflows/`:

```bash
mkdir -p .github/workflows
git mv .github/workflows-disabled/publish-images.yml .github/workflows/publish-images.yml
git commit -m "ci: enable image publishing workflow"
git push
```

If your token is rejected ("without `workflow` scope"), either add the file
through the GitHub web UI, or refresh your CLI token:

```bash
gh auth refresh -h github.com -s workflow
```
