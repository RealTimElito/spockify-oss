# Spockify

Self-hosted AI chat: Open WebUI fork, router (`spockify-auto`), LiteLLM, Ollama, SearXNG.

## Run with Docker (Ubuntu, Fedora, other Linux)

```bash
cp .env.example .env
make up                  # or ./docker/run.sh
```

Open http://localhost:3080 and create the first account (admin).

- Guide: [docker/README.md](docker/README.md)
- Pack a compose zip: `make kit` → `dist/spockify-docker.zip`
- Terminal CLI: `make build-cli`

Prebuilt images and a compose zip are published as GitHub Releases (`docker-v*`)
and at https://spockify.eu/downloads/spockify-docker.zip when a release is cut.
