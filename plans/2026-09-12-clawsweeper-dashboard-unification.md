# ClawSweeper Dashboard Unification Program — 2026-09-12

## Business purpose

Give Bobby one truthful, read-only view of Saari and DinkusKit review progress at
`clawsweeper.ztoned.com` without joining either tenant's execution authority.
Replace the misleading Saari engine-repository/error-rate view with exact
repository/PR tuple state, proof, provenance, and freshness.

## Ownership and route

- Final coordinator and product owner: Bobby.
- Implementation mutation owner: this durable ClawSweeper dashboard session.
- Repository: `saari-co/clawsweeper`.
- Branch: `codex/clawsweeper-dashboard-unification-20260912`.
- Worktree: `/Users/cp-1/Developer/worktrees/clawsweeper-codex-clawsweeper-dashboard-unification-20260912`.
- Fresh base: PR 15 head `77c6fb150ff63a463929b83f86bc7510e83c93c6`; the
  implementation is stacked to avoid overlapping its migration ownership.
- Proof root: `proof/clawsweeper-dashboard-unification-20260912/`.

## Verified starting state

- `saari-co/clawsweeper` main: `e893d50aed17568d41b8976fa727e4b6c63fa664`.
- PR 15 migration head: `77c6fb150ff63a463929b83f86bc7510e83c93c6`.
- `dinkuskit/clawsweeper` main/engine pin: `80cdeb241ab529008b1082749584be28a318e9ca`.
- `saari-co/review-conductor` main: `8516235599fb14b11c71c7960fcded578aa6cecd`;
  draft PR 3 owns standalone admission/service work and is out of scope.
- Last tracked ztoned deployment: source `ad47da5b21d92ec52f97908a866456e0ae391def`,
  Worker version `5311d062-3130-4bee-8247-6e88b1459473`; Access returns 302.
- Saari state: `saari-co/clawsweeper-state@state` `83498f82560a8dac7ad92f30869668ebf108512d`.
- DinkusKit state: `dinkuskit/clawsweeper-state@state` `de7c50ca3655fe48e51f251db93630e03eba1a8e`.

## Architecture and live-state sources

The ztoned Worker is an aggregator only. It consumes two isolated, read-only
service bindings exposing `clawsweeper.telemetry.v1`:

1. Saari projection: Spark-2 exact-head OpenClaw result, target-repository
   `clawsweeper-command` run, and state-branch proof links.
2. DinkusKit projection: repository-scoped caller workflow, pinned native
   canary result, and state-branch proof links.

Every feed carries its App installation identity, queue namespace, state store,
and mutation authority. The aggregator accepts no App key or writer credential.
Rows carry tenant, repository/PR, exact base/head, CI, OpenClaw, ClawSweeper,
official rating, proof links, engine SHA, observation time, freshness, and source.
Missing fields become `unknown`; unavailable sources use `row_count: null`.

## Idempotency and mutation ownership

- Read identity: `(tenant, repository, pr_number, head_sha)`.
- Aggregation is side-effect free and repeatable for identical feed bytes.
- Saari mutation remains in the Saari App/Spark-2 target lane.
- DinkusKit mutation remains in the DinkusKit App/repository caller lane.
- Review Conductor may orchestrate exact-head CI → OpenClaw → ClawSweeper but
  never gains merge authority.

## Rollout stages

1. Contract and fixture normalization; unit and type/build proof.
2. Local Worker/browser proof for All/Saari/DinkusKit, stale/unknown, and unavailable-source behavior.
3. Safe sample PR exact-head CI → OpenClaw → ClawSweeper review-only proof; at most two repair cycles.
4. Human gate: provision and verify both read-only feeder bindings.
5. Human gate: deploy `dashboard/wrangler.ztoned.toml`; verify Access, routes,
   tenant isolation, freshness, and rollback.

## Gates and stop conditions

- No merge, production deploy, Cloudflare/Gateway change, credential change,
  App permission/settings change, automerge, auto-close, or activation without
  fresh explicit approval for that action.
- Stop on source-head drift, unknown asset destination, cross-tenant authority,
  credential-bearing telemetry, inability to prove exact base/head, stale
  terminal review, or after two repair cycles.
- Review Conductor introduction is read-only contract work only.

## Rollback

Before production, abandon the branch/PR. After an approved deploy, restore
Worker version `5311d062-3130-4bee-8247-6e88b1459473` or redeploy source
`ad47da5b21d92ec52f97908a866456e0ae391def`; remove only the new service bindings
after traffic returns. Never delete tenant state.

## Explicit non-goals

- Shared tenant credentials, queues, state stores, engine pins, or writers.
- Merge, repair, labels, comments, dispatch, admission, or policy decisions from the dashboard.
- Enabling Review Conductor, automerge, auto-close, or advisory mutation.
- Translating absent telemetry into success, failure, or a percentage.
