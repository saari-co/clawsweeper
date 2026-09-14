# Saari exact-tuple review producer

Tenant-isolated reusable producer for the private suite target
`saari-co/openclaw-smcbd-suite` (numeric ID `1366416798`).

This workflow is source-only until independently reviewed and separately
activated. It does not schedule reviews, project checks, or replace Review
Conductor.

## Callable surface

Reusable workflow: `.github/workflows/saari-exact-tuple-review.yml`

The later suite wrapper, not this repository, must be named
`ClawSweeper exact-tuple review` at `.github/workflows/clawsweeper-exact-tuple.yml`.

Inputs bind exact `repository`, `pr_number`, `expected_base_sha`,
`expected_head_sha`, `review_epoch`, and `review_scope=comprehensive`.
`reviewer_actor` is the enrolled producer identity `saari-clawsweeper` from
trusted tenant config. Caller or PR stamps are rejected.

The artifact name is `smcbd-suite-review-<run_id>-<attempt>` and contains only
`manifest.json` plus `review/<pr>.md`.

## Runtime prerequisites

Hosted admission stays on `ubuntu-latest` and binds the exact suite tuple with
the caller `github.token` read scope. Native execution runs on
`[self-hosted, spark-2]` and reuses the existing host ChatGPT subscription
profile in place (`CODEX_HOME` + `CLAWSWEEPER_CODEX_LOGIN_METHOD=chatgpt`).
This producer does not use hosted API-proxy setup, does not require
`OPENAI_API_KEY` or `CLAWSWEEPER_MODEL`, does not consume Copilot, and does
not accept `COPILOT_GITHUB_TOKEN`.

The native job preserves the host-configured model through the public
`internal` alias. It does not copy, write, or inspect host auth, config, env,
or session files. Known host executables (`$HOME/.local/bin` and `CODEX_BIN`)
must already exist; the job fails closed if they are absent. Actual native
review holds the existing shared `~/.cache/clawsweeper/clawsweeper-command.lock`
and writes engine, target, empty state, and artifacts only under a unique
per-run `RUNNER_TEMP` tree. The trusted engine checkout is a unique path
under `GITHUB_WORKSPACE` because `actions/checkout` input-helper rejects
paths outside the workspace. `set-safe-directory: false` keeps checkout from
writing `safe.directory` into global git config. Shared Spark target
checkouts and global defaults are left untouched.

An optional `ENGINE_CHECKOUT_TOKEN` is needed only if the caller
`github.token` cannot read `saari-co/clawsweeper`. Suite runner-group
eligibility and host App qualification remain operational gates for the
existing deployment owner.

The trusted engine identity is `job.workflow_sha` / `job.workflow_repository` /
`job.workflow_file_path`, not the caller `github.sha`. Missing callee identity
or a stale exact tuple fails closed before host work. Caller-supplied
`engine_sha` must match that defining-workflow commit. The native job passes
`--disable-media-proof-preprocessing`, a live engine flag that skips host
curl/ffmpeg of PR-supplied URLs. `--local-only` alone does not skip that
preprocessor. Codex stays `--codex-sandbox read-only`.

No new long-lived state service, App, webhook, or shared writer is added.
Suite consumption uses the artifact only; comments, labels, and public state
publication stay off.

## Consumer proof

Standard `pnpm test` / `pnpm check` coverage is portable. It records the pin
and proves the command fails closed when no checkout is supplied. It does not
vendor, reimplement, or invoke `parse_clawsweeper_bundle`.

Real consumer proof is a separate recorded command that takes an independent
Review Conductor checkout, verifies the exact pinned file hashes, then runs
the supplied `parse_clawsweeper_bundle`. Omitting the checkout is a failure,
not a skip:

```sh
pnpm run prove:saari-exact-tuple-consumer -- --consumer-checkout <review-conductor-checkout>
```

The pin is `config/saari-exact-tuple-consumer-pin.json` for
`saari-co/review-conductor@2f5818cacdf84a72b22362f984d0c3d8c18af244`. That
proof is synthetic bundle admission only. It is not a live model review and
does not use `OPENAI_API_KEY`.

## Fail-closed rules

Unknown tenant IDs, stale base/head tuples, P0-only scope, malformed or partial
reports, caller-stamped actors, and missing artifacts fail closed. The
credentialed process never executes target PR code.
