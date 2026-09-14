# ClawSweeper telemetry feeder

Read-only Cloudflare Worker that serves one tenant's `clawsweeper.telemetry.v1`
envelope to the unified dashboard over a service binding. Deploy one copy per
tenant. The Worker never carries a writer secret or GitHub App private key.

The consumer is `dashboard/unified-review-dashboard.ts`. It fetches:

```text
GET https://telemetry.internal/v1/reviews/status
```

through the prepared bindings in `dashboard/wrangler.ztoned.toml`:

- `SAARI_REVIEW_TELEMETRY` → `clawsweeper-telemetry-saari`
- `DINKUSKIT_REVIEW_TELEMETRY` → `clawsweeper-telemetry-dinkuskit`

## Behavior

- `GET /v1/reviews/status` reads the tenant JSON from the GitHub contents API
  for `TELEMETRY_SOURCE_REPO` @ `TELEMETRY_SOURCE_REF`:`TELEMETRY_SOURCE_PATH`
  using `TELEMETRY_SOURCE_TOKEN` as a bearer. Timeout is 5s. Body size is
  capped at 1 MiB.
- The parsed document must be a well-formed `clawsweeper.telemetry.v1`
  envelope whose `tenant` equals `TENANT`. Rows are capped at the consumer
  `MAX_ROWS` (500).
- Any failure (network, non-200, malformed JSON, tenant mismatch, oversized)
  returns `503` with `{ schema_version, tenant, status: "unavailable", reason }`.
  The feeder never returns a partial feed and never infers success or failure.
- Other paths return `404`.
- Responses use `Cache-Control: no-store`. A valid envelope may be cached in
  memory for at most 30 seconds.
- Responses never echo the source token, request headers, or upstream error
  bodies.

## Prepared configs

| File                      | Worker name                       | `TENANT`    |
| ------------------------- | --------------------------------- | ----------- |
| `wrangler.saari.toml`     | `clawsweeper-telemetry-saari`     | `saari`     |
| `wrangler.dinkuskit.toml` | `clawsweeper-telemetry-dinkuskit` | `dinkuskit` |

Both configs set `account_id = "cddb32366789cab1bdf4c25584dc1920"`,
`workers_dev = false`, and add no routes. Consumers reach this Worker only
through a service binding.

## Variables

| Name                    | Role                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ |
| `TENANT`                | Envelope tenant (`saari` or `dinkuskit`).                                      |
| `TELEMETRY_SOURCE_REPO` | GitHub `owner/repo` that stores the published JSON.                            |
| `TELEMETRY_SOURCE_REF`  | Git ref (Saari default: `state`).                                              |
| `TELEMETRY_SOURCE_PATH` | Path inside that ref.                                                          |
| `STALE_AFTER_SECONDS`   | Publisher freshness policy hint. The feeder does not invent row state from it. |

## Secret

`TELEMETRY_SOURCE_TOKEN` is the only secret. It must be a read-only GitHub
token that can read `TELEMETRY_SOURCE_REPO` contents. Set it at deploy time
with Wrangler; never commit the value to this file, `wrangler.toml`, or
source.

Deployment, binding creation, and secret installation remain human-gated.
