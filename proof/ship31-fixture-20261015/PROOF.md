# Ship #31 exact source fixture qualification

## Claim and scope

The trusted host policy admits one additional complete Ship event-file blob for
an existing reviewed noncredential fixture identity. It does not add a general
UUID exception. The source change appends one whole-file SHA256 witness to the
existing Privacy/PLAIN policy row for `.grilltrack/events.jsonl`; all other row
fields and admission predicates remain unchanged.

Whole-source digest (not a match digest):
`c16070a86f786b162e7e2c413fc3049d429064f5ced8bb1ee3223c9ca4d76ac6`.
The preexisting complete-source witness remains admitted.

Policy base: `54fd1e420b261a123092791ae8466bf5e1d4ac2b` on
`saari-co/clawsweeper:saari-integration`.
Ship source: `dinkuskit/ship#31`, base
`fbb437bdd865258940b5dce16c431ae19cb71ede`, head
`8120e3336e7a5dba06642c3c5d7ade87a54d4c91`.

## Controlled runtime proof

On Spark-2, a new disposable checkout is pinned to the exact Ship head. Invoke
`scanAgentInput` with that checkout, the immutable committed base/head source,
a harmless controlled prompt, and a 180-second timeout. Run once with deployed
engine `11b47d125e1109160b017ec869d96750e37ff443`, then once with this candidate's
compiled module. Both use the existing pinned TruffleHog 3.97.4 executable and
the unchanged canonical scan and verification behavior. No model is invoked.

The sanitized [source scan receipt](source-scan.jsonl) records:

- Baseline: refused, `findings / unclassified_finding / source_not_reviewed`.
- Candidate: admitted, one classification notice.

The probe discards notice contents in memory and emits only statuses, diagnostic
categories, source tuple, notice count, and elapsed time. It preserves no matched
data, match digests, raw scanner output, or provider/authentication records.
This proves committed-source admission with the controlled prompt. It does not
prove admission of the full native review prompt/schema or a completed review.

## Tests and retained boundaries

Node 24.18.0 on Spark-2; compiled main and repair modules before focused tests:

```sh
pnpm run build:node
node --test test/agent-input-scan-event-uuid.test.ts test/agent-input-scan-fixtures.test.ts test/agent-input-scan.test.ts
```

Focused result: 814 passed, zero failed/cancelled/skipped. An initial attempt
before compiling repair modules failed to import a required module; the complete
build and rerun above resolved that validation setup failure.

The new synthetic Git fixture exercises two explicitly enumerated complete
blobs and refuses a third unlisted blob, a verified finding, and an altered
decoder. Existing tests cover altered identity/full line, path, mode, source
roles, extra/ambiguous references, omitted source constraints, and additional
unknown findings. No actual Ship event or match identity is copied into tests.

Full checks and independent review receipts are recorded in the PR/handoff.

Precommit independent review: Spark-2 Codex GPT-6.1 Sol, one completed attempt,
local candidate against base `54fd1e420b261a123092791ae8466bf5e1d4ac2b`;
P0 scoped-clean, no accepted/actionable findings (not comprehensive P3).
CP-1 receipt: `spark-openclaw-autoreview-20261015T144653Z-2545` under its installed
review-tools package `runs/spark-openclaw-autoreview-runs/`.

## Activation and limits

This PR changes source only. The E2E coordinator is the sole merge, immutable
engine provisioning, paired native-pin activation, and single Ship rerun closer.
The prior engine remains available for rollback. Both native consumer manifests
must move together; the general engine pin is outside this change.

No Bay change is needed: this host-side fixture admission update changes no
public status, telemetry, queue, publication, or dashboard contract.
