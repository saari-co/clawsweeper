# Review Conductor read-only observer handoff — 2026-09-12

## Purpose

Give Review Conductor a stable way to report exact-head orchestration progress
to the ClawSweeper dashboard without activating Review Conductor or granting it
merge, comment, repair, workflow-dispatch, App-management, or repository-write
authority.

## Identity and idempotency

Every status row is identified by:

`(tenant, repository, pr_number, base_sha, head_sha, epoch)`

`epoch` is the immutable orchestration attempt ID. Re-emitting the same tuple
and epoch replaces no state and has no side effect. A new PR head requires a new
tuple and invalidates terminal claims for the old head. Events arriving for an
older head or epoch remain historical and must not advance the current row.

## Read-only status contract

The tenant-owned observer service exposes `GET /v1/reviews/status` over a
Cloudflare Worker service binding. Its `clawsweeper.telemetry.v1` envelope has:

- tenant and generation time;
- tenant-owned App installation identity, queue namespace, state store, and
  mutation authority;
- repository/PR plus exact base and head SHAs;
- independent CI, OpenClaw, and ClawSweeper states;
- rating, bounded total/actionable finding counts, executor, engine SHA,
  observed time, freshness policy, source, and HTTPS proof links.

Missing telemetry is `unknown`; source failure is unavailable with a null row
count. No percentage or success/failure is inferred from absence.

## Optional event vocabulary

If Review Conductor later publishes tenant-local events, use append-only events
bound to the same tuple and epoch:

- `ci.requested|running|completed`
- `openclaw.requested|running|completed`
- `clawsweeper.requested|running|completed`
- `orchestration.blocked|superseded|completed`

Each event carries `observed_at`, `source`, and proof references. Status is a
deterministic projection of events for the current exact head; it is not an
instruction channel.

## Isolation and activation gates

- Saari and DinkusKit retain separate App installations, source identities,
  queue/state namespaces, engine/executor provenance, and mutation owners.
- Review Conductor never receives dashboard or tenant mutation authority.
- No webhook, deployment, credential, App permission, workflow dispatch,
  comment, merge, autofix, automerge, or auto-close activation is part of this
  handoff.
- Activation requires a separate reviewed implementation and Bobby's explicit
  action-time approval.
