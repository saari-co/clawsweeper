# Exact-tuple review producer

- Status: active, inert until explicitly dispatched
- Owner: ClawSweeper maintainers
- Source of truth: `src/saari-exact-tuple.ts`,
  `.github/workflows/saari-exact-tuple-review.yml`,
  `CLAWSWEEPER_EXACT_TUPLE_CONFIG`
- Last verified: this integration head
- Update when: the exact repo/PR/base/head/epoch/scope/actor contract, host
  reuse, consumer pin, or external overlay schema changes

Reusable producer: `.github/workflows/saari-exact-tuple-review.yml`

This workflow is source-only until independently reviewed and separately
activated. It does not schedule reviews, project checks, or replace Review
Conductor. It is `workflow_dispatch` / `workflow_call` only and does not alter
the default sweep rail.

## External tenant policy

Tenant policy is not baked into the engine. Hosts set
`CLAWSWEEPER_EXACT_TUPLE_CONFIG` to an absolute JSON overlay. The overlay must
add:

```json
{
  "schema_version": 1,
  "producer": {
    "engine_repository": "saari-co/clawsweeper",
    "workflow_path": ".github/workflows/saari-exact-tuple-review.yml"
  },
  "tenants": [
    {
      "repository": "example-org/example-private-suite",
      "repository_id": 1000000001,
      "visibility": "private",
      "default_branch": "main",
      "reviewer_actor": "example-reviewer-bot",
      "review_scope": "comprehensive",
      "artifact_prefix": "example-suite-review",
      "publish_side_effects": false
    }
  ]
}
```

The same host must also add a
`CLAWSWEEPER_REPOSITORY_PROFILE_OVERLAY` entry for each overlay tenant
(review-only, empty `apply_close_rules`). See
[Target repositories](target-repositories.md). The fixture shape is
`test/fixtures/saari-exact-tuple-overlay.json`. Those values are synthetic and
must not be treated as a live enrollment.

Inputs bind exact `repository`, `pr_number`, `expected_base_sha`,
`expected_head_sha`, `review_epoch`, `review_scope=comprehensive`, and
`engine_sha`. `engine_sha` is the issuer pin and must match the defining
workflow commit (`job.workflow_sha`). `reviewer_actor` and the artifact prefix
come from the overlay. Caller or PR stamps are rejected.

The artifact name is `<artifact_prefix>-<run_id>-<attempt>` and contains only
`manifest.json` plus `review/<pr>.md`.

## Optional process-gate evidence

A tenant may additionally enroll its Conductor check with
`"process_gate_check": {"app_id": 123, "name": "Native Review"}`. These are
synthetic values: use the actual trusted App ID and exact check name in the
private host overlay. Omission preserves legacy behavior and cannot qualify
`own_current_check`.

Before invoking the model, the credentialed runner reads the live PR and
exact-head check list. It requires an open matching repository ID/PR/base/head,
a complete check response, exactly one enrolled-issuer/name match, pending
status, and the Conductor external ID hashing repository/PR/base/head/epoch/name.
Model-provided identity, unrelated CI, a stale epoch, or a copied marker from
another App cannot qualify the gate.

The generation schema requires `processGates` (`[]` when none). Legacy stored
reports may still omit it; omission conveys no gate evidence. The array accepts only `own_current_check` and
`owner_merge_authority`. The generation schema bounds item values and count;
the parser enforces uniqueness because the native schema consumer rejects
array-valued enums and `uniqueItems`. Runtime rejects an unqualified
own-check claim and process claims on nonzero terminal exit. Reports serialize
validated reasons as JSON `process_gates` frontmatter. The field does not change
grades or findings and never grants merge authority. The model must assess
patch content independently of its own pending check; missing/empty evidence
or owner authority alone does not explain a non-ready grade. Findings, proof
deficiencies and explicit policy decisions continue to block in Conductor.

Controlled report/bundle consumer proof is available with
`node scripts/prove-process-gates.ts <current-conductor-checkout>` after build.
It is source/protocol proof, not deployment or a live-review claim.

## Runtime prerequisites

Hosted admission stays on `ubuntu-latest` and binds the live GitHub tuple with
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
writing `safe.directory` into global git config. Shared target checkouts and
global defaults are left untouched.

An optional `ENGINE_CHECKOUT_TOKEN` is needed only if the caller
`github.token` cannot read the producer repository.

The reusable-workflow caller must grant `contents: read`, `pull-requests: read`,
`issues: read`, `checks: read`, and `statuses: read`. Native PR hydration also
uses the Issues API for metadata/discussion and the Checks/Statuses APIs for
current CI context. The native job probes these read endpoints before engine
checkout. It has no GitHub write permission; its token and process-local Git
helper configuration are removed from the model environment.

The trusted engine identity is `job.workflow_sha` / `job.workflow_repository` /
`job.workflow_file_path`, not the caller `github.sha`. Missing callee identity
or a stale exact tuple fails closed before host work. Caller-supplied
`engine_sha` must match that defining-workflow commit. The native job passes
`--disable-media-proof-preprocessing`, a live engine flag that skips host
curl/ffmpeg of PR-supplied URLs. `--local-only` alone does not skip that
preprocessor. Codex stays `--codex-sandbox read-only`.

No new long-lived state service, App, webhook, or shared writer is added.
Tenant consumption uses the artifact only; comments, labels, apply, close, and
public state publication stay off.

## Consumer proof

Standard `pnpm test` / focused producer tests stay portable. They record the
pin and prove the command fails closed when no checkout is supplied. They do
not vendor, reimplement, or invoke `parse_clawsweeper_bundle`.

Real consumer proof is a separate recorded command that takes an independent
Review Conductor checkout, verifies the exact pinned file hashes, then runs
the supplied `parse_clawsweeper_bundle`. Omitting the checkout is a failure,
not a skip:

```sh
pnpm run prove:saari-exact-tuple-consumer -- --consumer-checkout <review-conductor-checkout>
```

The pin is `config/saari-exact-tuple-consumer-pin.json` for
`saari-co/review-conductor@f42875beeeab4cc1e82b701a692ff38ec8ac4a64`. That
proof is synthetic bundle admission only. It is not a live model review and
does not use `OPENAI_API_KEY`.

## Fail-closed rules

Unknown tenant IDs, stale base/head tuples, P0-only scope, malformed or partial
reports, caller-stamped actors, and missing artifacts fail closed. The
credentialed process never executes target PR code.
