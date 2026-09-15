# Strict process-gates generation schema repair

## Route and source

- Repository: `saari-co/clawsweeper` (GitHub ID `1271324490`).
- Base/PR target: `upstream-pin/d75f027faca8`, freshly fetched at
  `6b0c6087fc77278f1a249a6f6feee52cc1559719` (merged producer #24).
- Branch: `codex/strict-process-gates-release-schema-20260915`.
- Owner: native `schema_publish_closeout` (explicit handoff from `producer_schema_lineage_repair`); parent owns merge/deployment.
- `main` is a separate upstream lineage and is not the repair target.
- No production deployment, existing reviewer rerun, credential/profile change,
  protection change, comment/label/check mutation or historical proof rewrite.

## Behavior-proof contract

Claim: the complete producer generation schema is accepted by the existing
native Codex consumer and emits explicit `processGates: []` when none apply.
Legacy report omission remains accepted and conveys no positive gate evidence.
Semantic duplicate rejection remains in the production parser.

Surface: existing Spark-2 Codex 0.147.0, enrolled ChatGPT profile in place,
shared native-command lock, read-only sandbox, ephemeral invocation, isolated
synthetic temporary directory. No source-review task or tool use requested.

Command: `python3 accept-schema.py /tmp/clawsweeper-schema-release-20260915`
on that host, after copying this complete schema and proof script into the
isolated directory. The script suppresses raw diagnostics and returns only
fixed error markers, status and content hashes; no auth/config/session files
are inspected, copied or logged.

## Observed compatibility

1. The deployed schema omitted `processGates` from `required`. Adding it while
   retaining the newly introduced array-valued enum still produced
   `invalid_json_schema`. See `required-only-rejected.json`.
2. Removing that array-valued enum while retaining item enum and maximum length
   allowed the **complete** schema to execute successfully. See `accepted.json`.
   This isolates a second incompatibility rather than attributing the generic
   HTTP 400 solely to the missing required field.
3. Accepted exact schema SHA-256:
   `0423598ecf25415122817488b417879aa5ae3b509ed83bc71c0566b6c1c575af`.
4. Synthetic output SHA-256:
   `d8d1587930e3070a347d14984e6eb93ec0b793fc82a3659ad009167786c66373`.
   `synthetic-decision.json` contains all generation properties, empty gates,
   and explicitly says no source inspection/review occurred. It also passes
   the freshly built production `parseDecision` API.

Official strict schema contract:
https://developers.openai.com/api/docs/guides/structured-outputs#all-fields-must-be-required
All object properties must be required (nullable values express absence).
Observed array-enum incompatibility above is consumer evidence, not a claim
that arbitrary JSON Schema validators forbid array enum values.

## Regressions and limits

- Recursive generation contract checks every object (including nullable objects
  and anyOf branches) for required properties and additionalProperties:false;
  preserves existing forbidden-keyword checks and rejects non-scalar enums.
- Process-gates tests retain all five valid unique combinations, reject both
  duplicate values through the actual parser, and preserve legacy omission.
- Fresh build succeeded. Final frozen-source focused Codex/process-gates tests: **52/52 passed** (`node --test test/review-process-gates.test.ts test/codex-review-runner.test.ts`).
- Bounded independent precommit review cleared all four changed source/test/doc files with no actionable findings; it independently ran 9 process-gate tests and the recursive schema test. Limits: used the rebuilt `dist`, no new model invocation.
- The first full-check process started before the final enum-compatible test adjustment and retained the old enum assertion: 6,169 passed, 35 skipped, one failed. Its failure is preserved, not called green.
- A fresh full `pnpm run check` on the frozen final source is running; exact-head hosted CI is required at closeout. Final local status will be reported in the PR body.
- Committed-head comprehensive source qualification has not been performed by this publication lane and remains parent-owned before landing.
- Synthetic compatibility proof is NOT a review verdict, rail PASS, deployment
  proof, or evidence that comments/labels/cutover work.
- OpenClaw Bay is not affected: generation schema and local parser contract
  only; no public observer or API/data publication contract changes.
