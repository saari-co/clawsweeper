# Typed process-gate evidence

- Owner: producer implementation lane; branch `openclaw/typed-process-gates-20260915`.
- Base: `790fd23f6bd70298c4ad63ad951fe715a8d389c0`, fetched supported integration branch.
- Claim: explicit model process reasons can survive native report serialization, but only a runner-fetched exact-tuple, enrolled-issuer check qualifies `own_current_check`. No inference from grades, prose, or `keep_open`; no grade mutation or merge authority.
- Surface: Decision parser, runtime gate validator, original report renderer, original ZIP bundle producer, supplied current Conductor artifact consumer.
- Fixture: synthetic private repository, immutable base/head/epoch, injected GitHub API metadata. No live identities/credentials, actions or historical records.
- Controlled behavior command: `node scripts/prove-process-gates.ts <review-conductor-checkout>` on Node 24.15.0. This executes the actual report and bundle producer then Python `parse_clawsweeper_bundle`; it does not replace that parser with a mock.
- Result: [consumer-result.json](consumer-result.json) records consumer source/hash and clean review with human-only merge; findings, proof deficiency, policy and execution failures remain blocked; stale tuple rejected; missing own-check cannot waive a non-ready rating.
- Focused command: `node --test test/review-process-gates.test.ts test/decision-parser.test.ts test/saari-exact-tuple.test.ts`.
- Full required command: `pnpm run check` (terminal result appended at handoff).
- Limits: source/protocol proof only. No fresh live reviewer run, deployment, label/comment publication, or required-writer cutover is claimed. Existing historical review results remain unchanged.
- OpenClaw Bay: not affected. This is a tenant-configured private review protocol; no public observer surface or mutation controls added.

## Deployment dependency (root-owned)

Optional tenant overlay enrollment:

```json
{"process_gate_check":{"app_id":123,"name":"Native Review"}}
```

Use the actual enrolled Conductor App/check name in private deployment configuration. Existing overlays remain valid, but cannot qualify own-check evidence without enrollment. The workflow receives no new secret, permission, or dispatch input. GitHub API reads happen in the existing credentialed runner before model execution; no identities supplied by the model are trusted. Unknown, duplicate, missing/empty claims do not fabricate a gate. `owner_merge_authority` alone cannot waive a non-ready content rating.

## Precommit review and fresh-source validation

A regular native read-only reviewer found no actionable findings across tracked
and untracked source/tests/proof. Its six focused tests used the existing build;
that clearance did not claim rebuilt-source, full-suite, committed-head, or live
review proof. The implementation closer subsequently rebuilt all targets and ran
44 focused parser/exact-tuple/process-gate tests successfully on Node 26.4.0.
The actual report/ZIP producer to current Conductor parser proof also passed
against consumer commit `3d536c553abbf9361c3cefe5307b812982c931da`.

Prior full-suite investigation reproduced these unrelated failures on unchanged
base `790fd23f6bd70298c4ad63ad951fe715a8d389c0`:

- `lifecycle Bay streams more than 10k historical facts without losing lanes or revisions`
- `signed record export stops on serialized bytes and resumes at the unreturned record`

No baseline source was changed to conceal these results. Final fresh full-check
and hosted exact-head CI results are recorded in the PR handoff. Committed-source
review is a separate gate; no live reviewer or deployment result is claimed here.
