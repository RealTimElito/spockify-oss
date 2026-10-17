# G8 pilot (operator self-host rehearsal, no customer)

R2 asked for a 30-day controlled customer pilot. That artifact does **not**
exist. This file is the **operator self-host rehearsal**. It is not Green
and must not be described as a customer pilot.

## Can be executed locally

```bash
./docker/pilot-rehearsal.sh
```

The rehearsal runs, in order:

1. Production-profile fail-closed checks (secrets, loopback, isolated runner,
   digest pins, restore dry-run).
2. Offline SLO sample (`docker/slo-scrape.sh --offline`).
3. SBOM test: generate CycloneDX, refuse unsigned fakes, verify committed cosign bundle.
4. Signing refusal (`docker/sign-sbom.sh` must exit 2 without keys).
5. Canary pack lock: `packs/canary-v1.json` calc `max_rounds` is 1.

It does **not** start video generation, does not call kubectl, and does not
unload pinned models.

## Cannot be claimed

- No named customer.
- No 30-day production traffic.
- No signed pilot agreement / RTO/RPO.
- No G8 pass.
- Not a named customer.

Keep the rehearsal report if you run it. A green rehearsal is still G8 red
(operator self-host rehearsal, no customer).
