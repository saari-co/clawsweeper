# Reviewed acceptance fixtures (not model results)

These sanitized scenarios define the intended producer boundary. They are manually
reviewed acceptance fixtures, not executed tests, model outputs, or evidence that
prompt compliance improved. No new evaluator or implementation-mirroring test was
added.

## Retained process-only case

Source: [the merged x-api PR](https://github.com/saari-co/x-api/pull/848), retained
review base `c37495adffbbc844662d4e79ede5a328cfd3f303`, head
`2272275f47a06e78342663f51ec1a8fd85afbfd3`.

Minimal retained decision facts:

```json
{
  "reviewFindings": [],
  "risks": [],
  "securityReview": { "status": "cleared", "concerns": [] },
  "realBehaviorProof": { "status": "sufficient", "needsContributorAction": false },
  "maintainerDecision": { "required": false, "kind": "none" },
  "overallCorrectness": "patch is correct",
  "prRating": { "proofTier": "B", "patchTier": "B", "overallTier": "B", "nextSteps": [] },
  "workCandidate": "none"
}
```

The historical producer nevertheless emitted a typed **required** next step to
obtain full CI and comprehensive P3/exact-tuple review through the coordinator
handoff. Target policy, handoff, PR body and prior review contained those landing
obligations. The retained effective prompt already excluded routine CI: this is a
clarification candidate, not proof that missing guidance caused the failure.

Apply the case twice: (a) independent checks are pending, (b) their terminal
receipts are unavailable to the reviewer. Neither state alone establishes failure
or inadequate changed-behavior proof.

Expected: no required native-review next step or risk solely for those waits;
findings/risks stay empty and sufficient proof stays sufficient. The coordinator
still obtains all required landing evidence and ordinary final approval. This
fork's next-step prose is supplied by `workReason` (and quality moves by
`prRating.nextSteps`), not the newer upstream typed `nextStep`; do not introduce a
new output field. No rerender, canonical-status clearing, merge, or deployment is
part of this fixture.

## Countercases that must remain blocking

| Input variation | Expected existing-field treatment |
| --- | --- |
| A changed check invocation names a nonexistent script; pinned diff and failing log establish the introduced cause and exact file-level repair. Independent comprehensive review is also pending. | Report the concrete defect in `reviewFindings`, with repair routing as appropriate. Do not excuse it as routine CI or replace it with “wait for CI.” The finding remains blocking. |
| No patch defect is established, but the changed runtime behavior has no after-fix evidence; only unit tests or unrelated screenshots are supplied on an external non-docs PR. | `realBehaviorProof` remains missing/mock-only/insufficient as supported, `needsContributorAction: true`; name the missing changed-behavior scenario. Preserve the existing human-only proof block. Pending independent review does not fill that gap. |
| Applicable policy explicitly enforces current-head security approval, which is absent, or the patch has a concrete security concern. | Preserve the enforced approval in existing decision/security/risk fields as applicable; retain concrete concerns in `securityReview`. Do not treat it as ordinary landing approval or infer a waiver. |

Manual review: each exclusion is limited to process waits **merely** pending or
unavailable; the preservation sentence explicitly names diff-caused defects,
changed-behavior proof, security/approval gates and still-enforced maintainer-only
gates. These checks assess wording and compatibility with the current contract,
not a model's actual behavior.
