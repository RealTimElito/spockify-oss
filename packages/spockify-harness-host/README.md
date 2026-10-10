# @spockify/harness-host

stdio JSONL host for **Harness Profile v0** plugins.

- Default id `spockify` stays in-process `runHarness` (this package does not replace it).
- `listHarnesses` / `runPluginHarness` / `resolveHarnessOrFallback` — missing command → error + fall back to spockify (never hang).

See `docs/HARNESS_PROFILE.md`.
