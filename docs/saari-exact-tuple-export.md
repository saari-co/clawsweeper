# Exact-tuple producer public export receipt

- Status: active source qualification
- Owner: ClawSweeper maintainers
- Source of truth: this page, `config/saari-exact-tuple-extraction.json`,
  `config/saari-exact-tuple-consumer-pin.json`
- Last verified: this integration head
- Update when: the producer source, consumer pin, or export scan changes

This page records the sanitized public-export candidate. It is not a live
dispatch, activation, or Review Conductor campaign.

## Provenance

- Supported base: `saari-co/clawsweeper@c1b106d723663d655b1404480ab6e640333970af`
- Consumer pin: `saari-co/review-conductor@f42875beeeab4cc1e82b701a692ff38ec8ac4a64`
- Extraction contract: `config/saari-exact-tuple-extraction.json`
- Overlay fixture: `test/fixtures/saari-exact-tuple-overlay.json` (synthetic
  tenant only)

The producer was rewritten onto the supported base. Historical private-suite
commits were not cherry-picked or merged.

## Export scan patterns

The scripted scan searches added and modified filenames and `+` diff lines from
the supported base for these pattern names:

- private-suite-repository
- private-suite-numeric-id
- real-reviewer-actor
- real-artifact-prefix
- machine-user-home-path
- private-workspace-path
- host-product-path
- customer-product-token
- secret-ref
- live-token-value

Synthetic fixture identities (`example-org/example-private-suite`,
`example-reviewer-bot`, `example-suite-review`) are allowed. Generic references
to `saari-co/clawsweeper` and Review Conductor are allowed.

## Verification

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | passed |
| `pnpm run format` | passed |
| `pnpm run build:all` | passed |
| `pnpm run lint` | passed |
| `pnpm run format:check` | passed |
| `pnpm run check:static` | passed, including `check:docs` |
| `node --test` on `test/saari-exact-tuple.test.ts`, `test/saari-exact-tuple-consumer.test.ts`, `test/repair/exact-review-bundle.test.ts`, `test/repository-profiles.test.ts` | 48 passed |
| `node --test` after default-rail follow-up on `test/repair/workflow-sparse-checkout.test.ts` and `test/review-comment-rendering.test.ts` | 117 passed with the producer files |
| `pnpm run prove:saari-exact-tuple-consumer -- --consumer-checkout <pinned-conductor-checkout>` | passed: admitted comprehensive bundle (`verdict=clean`, `ready_qualified=true`); rejected repository, PR, head, base, epoch, P0-only, caller-stamped actor, and incomplete cases |
| `actionlint .github/workflows/saari-exact-tuple-review.yml` | passed |
| Ruby `YAML.load_file` on the reusable workflow | passed |
| `git diff --check` | passed |
| scripted export scan over `git diff --cached` from `c1b106d7` | clean (0 findings) |
| `pnpm run check` | static, build, lint, and producer-owned tests passed; `test/github-webhook-read-model.test.ts` still fails on the supported base from webhook TTL date-rot (August 2026 fixtures). That failure is unrelated to this producer. Apply-drift-refresh requires Bash 4+ (`mapfile`); it passed once Bash 5.3 was on `PATH`. |

No live dispatch, branch protection, secret, GitHub App, merge, review campaign, or obsolete public PR reuse was performed.
