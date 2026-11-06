# Proof — Re-integrate `saari-co/clawsweeper` (`saari-integration`) onto Upstream `openclaw/clawsweeper` `main` + PRs `#45` & `#46`

## Summary

- **Repository**: `saari-co/clawsweeper`
- **Target Branch**: `saari-integration`
- **Worktree Branch**: `codex/upstream-main-integration-20261105`
- **Previous `saari-integration` Base**: `bb90b25f456957319a1da44e949f2ea9b748f4cb`
- **Merged Upstream `openclaw/clawsweeper` `main` Head**: `b5cb826882d5093d711ad52428aff7828dcdacb8` (includes [`openclaw/clawsweeper#2058`](https://github.com/openclaw/clawsweeper/pull/2058) and [`openclaw/clawsweeper#1833`](https://github.com/openclaw/clawsweeper/pull/1833))
- **Folded Saari PRs**:
  - [`saari-co/clawsweeper#45`](https://github.com/saari-co/clawsweeper/pull/45) (`933b4ca96e3ca2257de3cf849982c12f3848dd93`): Closed source-line witness reason codes (`unique_plain_literal`, `ambiguous_literal`, `unsupported_decoder`, `not_staged_blob`, `unproven`) in `src/agent-input-scan-fixtures.ts` and `scripts/proof-scan-witness-reasons.mjs`.
  - [`saari-co/clawsweeper#46`](https://github.com/saari-co/clawsweeper/pull/46) (`3338f050d6ca87644f1eb66fc0f7eb447a63403a`): Coordinator-owned landing check guidance under `## Process waiting versus patch content` in `prompts/review-item.md`.

## Preserved Saari Integration Capabilities & Retired Fork Patches

- **Preserved**:
  - Exact-tuple admission, identity binding, report frontmatter/section rendering, and consumer proof (`src/saari-exact-tuple.ts`, `.github/workflows/saari-exact-tuple-review.yml`, `scripts/validate-saari-exact-tuple-report.mjs`, `scripts/prove-saari-exact-tuple-consumer.mjs`).
  - External repository profile overlay (`src/target-repository-config.ts`, `CLAWSWEEPER_REPOSITORY_PROFILE_OVERLAY`).
  - Process gate qualification and report parsing (`src/review-process-gates.ts`, `prompts/review-item.md`).
  - Unified multi-tenant review dashboard routes (`/api/reviews`, `/api/private/reviews`, `/reviews`) in `dashboard/worker.ts` and `dashboard/unified-review-dashboard.ts`, plus `scripts/telemetry/publish-saari-review-telemetry.mjs`.
  - Explicit `--model` forwarding in `codexModelArgs` (`src/clawsweeper-codex-env.ts`).
  - Reviewed scanner attributions (`REVIEWED_ATTRIBUTIONS` in `src/agent-input-scan-fixtures.ts`, including `b413df59-25d4-46a2-a40e-db93fb856fb3`).
- **Retired (superseded upstream)**:
  - `src/clawsweeper-report-parser.ts` (split into modular report presentation/metadata modules in `openclaw/clawsweeper#1919`).
  - `src/repair/target-toolchain-config.ts` and `test/repair/issue-implementation-intake.test.ts` (deleted in `openclaw/clawsweeper#1929`).
  - `changelog.d/reviewed-event-uuid.md` (already stitched into `CHANGELOG.md` upstream).
  - `/api/automerge-metrics` (`AUTOMERGE_CACHE_TTL_SECONDS`) dashboard endpoint (removed upstream in `openclaw/clawsweeper#1929`).

## Verification

1. **Fast Static, Build, and Lint Gate (`pnpm run check:fast`)**:
   - `check:active-surface`: passed
   - `check:changelog`: passed (47 pending fragments)
   - `check:dashboard-queue-boundary`: passed
   - `check:dashboard-strict`: passed
   - `check:docs`: passed
   - `check:limits`: passed
   - `format:check`: passed (966 files)
   - `build:all` (`build`, `build:repair`, `build:dashboard`): passed
   - `lint` (`lint:src`, `lint:repair`, `lint:dashboard`, `lint:scripts`): 0 warnings, 0 errors

2. **Scanner Source-Witness Proof (`TMPDIR=/private/tmp node scripts/proof-scan-witness-reasons.mjs`)**:
   - Exercised TruffleHog `3.99.4` against synthetic `unique` and `repeated` committed source scenarios:
     `{"passed":true,"output":"/private/tmp/scan-witness-reasons.json","scenarios":2}`

3. **Full Test Suite (`TMPDIR=/private/tmp pnpm run test:no-build`)**:
   - 403 test files executed (`7219` tests: `7188` passed, `0` failed, `31` platform-skipped).
