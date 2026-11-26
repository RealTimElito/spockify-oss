# @spockify/harness-adapter-external

Optional **extra** for third-party harness binaries. Spawns their CLI with
`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` pointing at LiteLLM and
forwards stdout JSONL as profile-v0 events.

- Not under `services/`
- Not a default compose/image dependency
- Register via `~/.spockify/harnesses/<id>.yaml` (see `docs/HARNESS_PROFILE.md`)
