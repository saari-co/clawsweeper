# Operator configuration ownership

- Status: active operator reference
- Owner: ClawSweeper deployment and workflow maintainers
- Source of truth: `dashboard/wrangler.toml` and `.github/workflows/`
- Last verified: `openclaw/clawsweeper@647503ec44b8e777dd172adf974a945367da0d19`
- Update when: an audited name is removed, renamed, or changes responsibility, or a source-verified ownership gap is added to this inventory
- Checked by: `pnpm run check:docs`

This page records names and ownership boundaries only. Never copy secret values
into documentation, issues, logs, or pull requests. The committed Wrangler file
is authoritative for selected deployment values; GitHub repository or
environment settings are authoritative for workflow variables and secrets.

## Dashboard Worker variables

| Name                                  | Responsibility                                                             |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `CLAWSWEEPER_REPO`                    | Repository used by ClawSweeper-specific projections.                       |
| `PUBLIC_BAY_REPOS`                    | Verified-public repositories eligible for minimal Bay/Overview references. |
| `PRIVATE_OBSERVER_ACCESS_TEAM_DOMAIN` | Cloudflare Access team issuer used to verify private observer JWTs.        |
| `PRIVATE_OBSERVER_ACCESS_AUD`         | Existing Access application audience required by the private observer.     |
| `WORKER_DETAIL_RUN_LIMIT`             | Maximum workflow-run detail set fetched for dashboard assembly.            |
| `WORKER_JOB_FETCH_CONCURRENCY`        | Concurrency for workflow-job detail fetching.                              |
| `WORKER_JOB_CACHE_TTL_SECONDS`        | Workflow-job cache lifetime.                                               |
| `WORKER_HEALTH_CACHE_TTL_SECONDS`     | Workflow-health cache lifetime.                                            |
| `WORKER_HEALTH_FETCH_CONCURRENCY`     | Concurrency for workflow-health fetching.                                  |
| `AUTOMERGE_CACHE_TTL_SECONDS`         | Automerge metrics cache lifetime.                                          |
| `RECENT_CLOSED_CACHE_TTL_SECONDS`     | Recently closed item cache lifetime.                                       |
| `INCLUDE_CI_STATUS`                   | Enables CI status in dashboard assembly when selected.                     |
| `REVIEW_OBSERVABILITY_REQUIRED`       | Selects whether review observability is required for status assembly.      |
| `REVIEW_RECOVERY_ENABLED`             | Selects review recovery behavior in the deployed Worker.                   |

## Workflow credential names

Provider keys used by the optional OpenClaw runner are `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `KIMI_API_KEY`, and `OPENROUTER_API_KEY`. Maintainer-report
and Cloudflare access workflows reference `CLOUDFLARE_ACCESS_CLIENT_ID`,
`CLOUDFLARE_ACCESS_CLIENT_SECRET`, `OPENCLAW_CLOUDFLARE_ACCESS_API_TOKEN`,
`OPENCLAW_CLOUDFLARE_CONFIG_API_TOKEN`, `OPENCLAW_CLOUDFLARE_PAGES_API_TOKEN`,
`OPENCLAW_REPORTS_ACCESS_CLIENT_ID`, and `OPENCLAW_REPORTS_ACCESS_CLIENT_SECRET`.
Their consuming workflows own whether they are required; no values are recorded
here.

`config/operator-documentation.json` pins this deliberately scoped audited set so
`pnpm run check:docs` fails if a name disappears from its owning source or this
page. It does not require every repository workflow secret or dashboard setting
to be duplicated here. [Automation limits](limits.md) remains canonical for
capacity and timing values.

The two private-observer values are owned by the dedicated ztoned deployment
configuration. They are non-secret identifiers, but setting them and deploying
the Worker remain action-time human gates. The Worker verifies the Access JWT
against Cloudflare JWKS before reading private tenant telemetry. It does not
accept an unverified identity header or serialize the assertion to clients.
