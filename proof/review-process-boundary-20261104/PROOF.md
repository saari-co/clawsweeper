# Producer review/process boundary

## Scope and source

Ryan authorized the smallest producer-prompt clarification (Discord
1567624371982307369). Source baseline and observed remote `main`:
`f810509b68274934fc8c0a18d477c9521c7965e5`. Only the isolated task checkout was
edited; no upstream sync, source pin, runtime, workflow, trigger, reconciler,
renderer, canonical status, merge policy or deployment changed.

The current fork loads `prompts/review-item.md` through
`src/clawsweeper.ts:reviewPromptTemplate`; its next-step prose comes from
`workReason`. It does not have the newer upstream typed producer `nextStep`.
The nine-line clarification sits beside the existing next-action/`bestSolution`
rule, without importing upstream restructuring or adding an output field.

The retained [x-api review](https://github.com/saari-co/x-api/pull/848) accepted
behavior proof and reported no patch findings, risks, security concern or required
maintainer decision, yet required CI/comprehensive evidence as its next step.
The effective retained prompt already excluded routine CI. This change clarifies
the target-policy boundary; it is not proof of the historical model's internal
cause or of improved compliance. Upstream consultation reference:
`openclaw/clawsweeper@03e24309cf919bf866bb2ffe2551beca27fd9bb3`,
`prompts/review-item-pr.md`, merge-work guidance excluding routine process waits.
No dependency/pin update is implied.

## Acceptance and limits

[Reviewed acceptance fixtures](ACCEPTANCE.md) preserve only necessary sanitized
facts: sufficient proof/no defect with pending or unavailable independent checks,
plus countercases for a diff-caused check defect, insufficient changed-behavior
proof and an explicitly enforced security approval. Landing checks remain owned
by the coordinator; genuine defects, proof gaps and enforced gates remain in
their existing fields.

No bounded retained-context producer evaluation facility was found in package
scripts, `scripts/`, tests or the local-review skill. Existing local item/range
commands perform a different full review, not this replay. No new evaluator,
mirroring tests, model worker or duplicate native review was added.
**Model behavior is unverified.** Fixtures and static checks are not runtime/model
proof; independent PR reviews are also not a PR848 replay.

## Checks

- Node `v26.11.1`, pnpm `11.10.0`; frozen-lockfile dependency install passed.
- Production prompt-loader equality to the edited source passed after build;
  SHA-256 `4be9f6639965372cb21cd719916135e25081139312752299d2e4c8784a76bdad`.
  This is static source-path verification, with no model call.
- `git diff --check`: passed.
- Full `pnpm run check`: passed (exit 0), including all builds, lint, unit and
  repair suites, changed/full coverage thresholds and formatting. Final full
  coverage run: 1,321 passed, zero failed/cancelled. Initial invocation hit the
  tool's 200-second timeout and is not clearance; the complete rerun is.
  Formatting follows the repository script's configured paths (not prompt prose).

Generated logs, input hashes, STATE, events and heartbeat are retained in the
assigned machine-run proof directory. PR-visible CI and exact-source review
identity/status will be maintained in the PR body. Native automatic admission is
observed, not duplicated. No merge or deploy is authorized by this proof.
