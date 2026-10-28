# Public site (spockify.eu)

Static splash source of truth: `site/index.html` (also published as
`k8s/ide-site/www/home.html` in the live `/ide` ConfigMap). Thin pages
`site/self-host.html` and `site/product.html` ship beside it.

## Live today

| Path | Backend |
| --- | --- |
| `/` (Exact) | `spockify-ide-site` → `home.html` (`spockify-site-apex`) |
| `/chat` | Open WebUI (`spockify` ingress) |
| `/api`, `/ws`, `/_app`, `/oauth`, `/static`, … | Open WebUI via Prefix `/` on the same ingress (asset roots OWUI requests) |
| `/ide` | `spockify-ide-site` ConfigMap nginx |
| `/home`, `/self-host`, `/product` | `spockify-ide-site` (`spockify-site-pages` rewrite → `*.html`) |
| `/downloads/…` | `spockify-downloads` hostPath (files 200; bare `/downloads` is an index stub) |

Sign-in CTA on the splash points at `/chat`. Do not put SWE on this ingress.

## Reload static only

```bash
kubectl apply -k k8s/ide-site
# optional: delete obsolete Exact /home ingress if pages ingress replaced it
# kubectl -n spockify delete ingress spockify-site-home --ignore-not-found
```

No new Open WebUI / router images for page edits. Apex rollback dump:
`snapshots/site-apex-rollback-20260920-110015/`.
