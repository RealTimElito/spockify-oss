# Contributing to Spockify

Thanks for your interest in improving Spockify.

## Ground rules

- Prefer new, self-contained code over deep edits to vendored upstream files.
  New chat/router behavior belongs in `services/router` or the Spockify-owned
  Open WebUI routes (`services/openwebui/upstream/backend/open_webui/routers/spockify.py`)
  rather than stock upstream modules.
- Keep secrets, hostnames, IP addresses, and personal data out of the tree. Use
  environment variables and `.env` (which is gitignored).
- Don't commit models, checkpoints, build artifacts, or vendor blobs.

## Development

```bash
cp .env.example .env
docker compose up -d
```

- Router: Python (FastAPI) under `services/router`. Follow the Google Python
  style guide; run its tests with `pytest services/router`.
- Extension / packages: TypeScript under `extensions/` and `packages/`. Use each
  package's own `npm test` / build scripts.

## Pull requests

- Keep changes focused and describe the "why".
- Use Conventional Commits for messages (e.g. `feat:`, `fix:`, `docs:`).
- Make sure existing tests pass and add tests for new behavior where practical.

## Reporting security issues

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
