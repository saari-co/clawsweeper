# x-api #728 scanner qualification

Claim: admit two intentional reserved-domain URI fixtures through their exact
native identities, canonical path, complete source lines and Git attribution.
No generic URL, directory, detector or value-only exception is added. The
canonical complete-source scanner, verification and unknown-finding refusal
remain enabled. The two rows permit only observed PLAIN decoding and mode100644.

Target: `saari-co/x-api#728`, base
`6364e9339979179374223dc7c11a1506ba3cc995`, head
`7e5e808ec8b7acc4d9a9221a1d67e14b21ff1b26`.
Native refusal run: `39094514529`; first rejected finding was URI detector17,
PLAIN, unverified, in the complete patch. The bounded native inventory contains
four findings: source lines720 and746 of
`tonight-lab/tests/test_smoky_runner_storefront.py`, plus their added patch copies.

The fixtures live in `test_exact_beacon_suppression_and_sanitized_denial_classifier`
and `test_known_beacon_route_fulfills_locally_without_fetch`. Opaque structural
inspection verified generic hardcoded user/password placeholders on reserved
`.test` hosts, explicit output-redaction assertions, and mocked local beacon
handling. No account, credential store or auth log was opened. No detected value
is included in this proof or the policy: policy stores only exact digests.

Source blob: `ec5b1c5455a1c3483b54d7d3250b3716fa21f7b1`, 65189 bytes,
whole-file SHA256 `60042c3bc9b15ee8a7bd4c1769fdef58d2422f10195b1238a457c06bb297d033`.
This whole-file digest identifies the evidence input; URI admission uses the
existing complete-line/identity/path/mode/Git-attribution policy rather than
claiming a new whole-file-only predicate.

## Runtime proof

Environment: Spark-2 host, Node24.18.0; existing pinned TruffleHog3.97.4,
canonical verification enabled. No model call, native retry or production change.
The baseline was engine `1fdf1acdf6698e7254fe18870fcc95ad1f8fec3a`.

[Baseline observation](baseline-observation.json) invokes the actual
`scanAgentInput` API with the complete committed range and a controlled prompt.
An observation hook reads native output in memory without modifying scanner
arguments, environment, return values or bytes. It emits only safe attribution
metadata and writes exact digests directly into candidate policy, never raw
findings or matched strings. The source line witnesses resolve exactly to720
and746; all four findings match the expected unverified URI shape. Baseline
refuses; the controlled prompt's first refusal is `literal_not_reviewed`, while
the original native prompt first refused the patch as `material_not_reviewed`.
These are distinct prompts and findings order, not recovery of the original input.

[Candidate proof](candidate-probe.json) invokes the actual scanner API with the
same source and controlled prompt. Exact input admits. Independent disposable
Git inputs preserve source provenance and prove these refusals:

- Changed full line: `literal_mismatch`.
- Renamed path: `source_not_reviewed`.
- Changed URI: `literal_not_reviewed`.
- Additional occurrence: `literal_mismatch`.

Only safe categories, whole-source identities, notice counts and source commits
are retained. Source clones and generated runs stay outside the product checkout.
The x-api branch/history is unchanged. This proof does not replace scanning the
actual native review prompt/schema after an approved engine activation.

## Tests, ownership and remaining gates

The focused regression uses separately synthesized URIs, real Git-generated
added/removed/context patches, and exact attribution rows. It covers missing row,
value/full-line/path/role/mode/revision changes, unsupported decoder, verified
finding, additional occurrence and an unknown finding. No original URI is copied
into the regression source. Focused scanner tests: 789 passed, zero failed/skipped. Precommit review and
committed exact-head review are recorded in the PR handoff; full checks pending.

Source owner: this isolated engine qualification task. Parent owns x-api and
merge/deployment decisions. Current remote `main` no longer contains this scanner;
the freshly fetched owning `saari-integration` base is
`e73929ec32270dba52965ca6cdf82dbca74acf10`. This change targets that existing
native engine line rather than importing it into unrelated `main`.

No Bay change: host-side input admission changes no public queue/status/dashboard
contract. No live engine/pin change, credential action or x-api review retrigger is
performed. After review and actual owner approval, provision an immutable engine,
update the paired native pins through the owned receiver process, verify them,
and request at most one current-head native review. This PR grants no activation.
