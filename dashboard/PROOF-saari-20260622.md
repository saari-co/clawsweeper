# saari-co ClawSweeper Dashboard Deploy Proof

Date: 2026-06-22
PR: https://github.com/saari-co/clawsweeper/pull/3

## Result

`clawsweeper.ztoned.com` is deployed on Cloudflare Workers and protected by
Cloudflare Access.

## Cloudflare Resources

- Account: Growfunkybeans/ztoned account (`cddb32366789cab1bdf4c25584dc1920`)
- Zone: `ztoned.com`
- Worker: `clawsweeper-ztoned`
- Worker version: `5311d062-3130-4bee-8247-6e88b1459473`
- Custom domain: `clawsweeper.ztoned.com`
- Durable Object binding: `STATUS_STORE` / `StatusStore`
- Worker subdomain: disabled
- Preview subdomains: disabled
- Access application: `clawsweeper`
- Access policy: `ClawSweeper operators`
- Allowed emails:
  - `smokyproductcompany@gmail.com`
  - `growfunkybeans@gmail.com`
  - `tsaari71@gmail.com`

## Commands

```bash
npx wrangler@4 deploy --dry-run --config dashboard/wrangler.saari.toml
gh auth token | npx wrangler@4 secret put GITHUB_TOKEN --config dashboard/wrangler.saari.toml
npx wrangler@4 deploy --config dashboard/wrangler.saari.toml
curl -sS -D /tmp/clawsweeper-root.headers -o /tmp/clawsweeper-root.body https://clawsweeper.ztoned.com/
curl -sS -D /tmp/clawsweeper-health.headers -o /tmp/clawsweeper-health.body https://clawsweeper.ztoned.com/api/health
curl -sS -D /tmp/clawsweeper-workersdev.headers -o /tmp/clawsweeper-workersdev.body https://clawsweeper-ztoned.growfunkybeans.workers.dev/
```

## Verification

- Wrangler dry-run passed.
- Wrangler deploy passed.
- `https://clawsweeper.ztoned.com/` returns Cloudflare Access redirect (`302`).
- `https://clawsweeper.ztoned.com/api/health` returns Cloudflare Access redirect (`302`).
- `https://clawsweeper-ztoned.growfunkybeans.workers.dev/` returns `404` / Cloudflare error `1042`.
- Cloudflare API confirms:
  - `clawsweeper.ztoned.com` custom domain is attached to `clawsweeper-ztoned`.
  - Worker subdomain is disabled.
  - Preview subdomains are disabled.
  - Access app and allow policy exist.

## Notes

The initial `GITHUB_TOKEN` secret was set from the local authenticated GitHub
keychain without printing token material. The runbook documents the preferred
long-term credential: a fine-grained read-only PAT scoped to the configured
saari-co repositories with Actions, Contents, Issues, Pull requests, and
Metadata read permissions.

## Gates

No ClawSweeper advisory sweep was enabled, no GitHub labels/comments were
written by this slice, and no ClawSweeper App private key was moved or used.
