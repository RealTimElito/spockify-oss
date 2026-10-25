# G6 30-day SLO (window starts now)

Machine spec: `docker/slo.json` (`docker/slo.yaml` is a pointer). One sample is
`docker/slo-scrape.sh --offline --record DIR`.

This is **not** a published SLA and not a signed RTO/RPO. The 30-day window
starts `2026-10-17T16:00:00+02:00`. `history_days_available` counts **complete
calendar days before today** that already have a JSONL sample; on day one that
is **0**. Do not invent prior days. One real offline sample was recorded on
the operator host at `/var/lib/spockify/slo/slo-samples.jsonl` on 2026-10-17.

## Objectives (operator, single-tenant)

| Id | Indicator | Objective | How it is measured |
|----|-----------|-----------|--------------------|
| `slo.local.chat_health` | availability | 0.99 | Optional `SPOCKIFY_SLO_CHAT_URL` + `/health`. Down → skip. |
| `slo.local.router_health` | availability | 0.99 | Optional `SPOCKIFY_SLO_ROUTER_URL` + `/health`. Down → skip. |
| `slo.restore.rto` | latency | 900s | Throwaway compose restore drill. Local synthetic ~1s. Not signed. |
| `slo.isolation.fail_closed` | boolean | true | Harness unit: production without bwrap/podman errors. |
| `slo.sbom.inventory` | boolean | true | CycloneDX + cosign sidecar verifies. Not SLSA. |
| `slo.video.enabled` | expected skip | n/a | Video is operator-enabled. Do not POST /v1/videos from the scrape. |

## Recording

```bash
./docker/slo-scrape.sh --offline --record ./data/spockify
# optional loopback probes (skip if down):
SPOCKIFY_SLO_CHAT_URL=http://127.0.0.1:3080 \
SPOCKIFY_SLO_ROUTER_URL=http://127.0.0.1:4100 \
  ./docker/slo-scrape.sh --record ./data/spockify
```

Schedule (operator host): `spockify-slo-scrape.timer` is enabled and
active. Next fire `*-*-* 16:00:00` local. It runs `/opt/spockify/slo/run.sh`
(copy of `docker/slo-scrape.sh` + `docker/slo.json`) and appends one sample to
`/var/lib/spockify/slo/slo-samples.jsonl`. Installed after the 16:00 window
start on 2026-10-17, so the first timer tick is the next calendar 16:00; the
JSONL already has the install-day sample.
Install:

```bash
sudo mkdir -p /opt/spockify/slo/docker /var/lib/spockify/slo
sudo cp docker/slo-scrape.sh docker/slo.json /opt/spockify/slo/docker/
printf '%s\n' '#!/bin/bash' 'exec bash /opt/spockify/slo/docker/slo-scrape.sh --offline --record /var/lib/spockify/slo' \
  | sudo tee /opt/spockify/slo/run.sh >/dev/null
sudo chmod 755 /opt/spockify/slo/run.sh /opt/spockify/slo/docker/slo-scrape.sh
sudo cp scripts/systemd/spockify-slo-scrape.service \
        scripts/systemd/spockify-slo-scrape.timer /etc/systemd/system/
sudo systemctl enable --now spockify-slo-scrape.timer
```

The script never calls kubectl, never starts video generation, and never
unloads pinned models. A green scrape path is not a 30-day dashboard.
