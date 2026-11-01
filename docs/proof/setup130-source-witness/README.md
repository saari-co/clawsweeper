# Source witness refusal reasons

Setup PR [130](https://github.com/saari-co/smokyworker_setup/pull/130), at head
`6b700f46c22b180a4c753baa4b0155770fea8470` and base
`fcf5513f5271da0d637eacdd63067f8f676f20af`, stopped before native review in
[receiver 41316732578](https://github.com/saari-co/spark-dgx/actions/runs/41316732578).
Its safe manifest attributed four URI findings to base/head test-harness blobs,
but every source line was unavailable. That did not establish whether the
limitation was decoding, repeated text, absent text, or an input-size limit.

This change adds `sourceLineReason` to the bounded native finding inventory.
It describes the first failed source-witness condition using a closed enum.
It never includes the matched text, a source excerpt, or a decoder error.
`sourceLine`, `sourceLineStatus`, scanner decisions, fixture policy, and
inventory size/count limits retain their existing behavior.

| Reason | Meaning |
| --- | --- |
| `unique_plain_literal` | One exact PLAIN occurrence proves the reported source line. |
| `unsupported_decoder` | The existing witness supports only PLAIN decoding. |
| `not_staged_blob` | There is no host-staged original blob for this finding. |
| `missing_source_bytes` | The staged blob has no retained bytes. |
| `missing_literal` | The scanner supplies no nonempty string `RawV2`. |
| `source_size_limit` | The source exceeds the existing 1 MiB witness limit. |
| `literal_size_limit` | The literal exceeds the existing 65,536-character limit. |
| `invalid_source_utf8` | Strict source decoding failed. |
| `literal_absent` | The exact literal is absent from the source bytes. |
| `ambiguous_literal` | Multiple exact occurrences prevent unique attribution. |

No reason establishes fixture eligibility. In particular, a test path,
`verified:false`, or `ambiguous_literal` is not permission to admit a finding.
Scanner coordinates remain separate from proven source coordinates.

## Behavior proof contract

The changed surface is the metadata emitted by the production `scanAgentInput`
path. The controlled proof uses pinned TruffleHog 3.97.4, real Git commits, and
new synthetic URI fixtures on a reserved `.invalid` host. Unique and repeated
source occurrences remain refused with exit 79; the safe diagnostic explains
their source-witness results. No model, GitHub review, or live target executes.
The script preserves its disposable fixture directories and emits only safe
metadata. Run after building, with the pinned scanner already available:

```sh
pnpm run build
node --test test/agent-input-scan-fixtures.test.ts
node scripts/proof-scan-witness-reasons.mjs artifacts/scan-witness-reasons.json
```

Focused unit coverage also exercises decoder rejection, overlapping duplicate
matches, missing text/bytes, strict UTF-8 errors, and existing size limits.
Native proof does not substitute for unit coverage of those synthetic edge
conditions, nor does it qualify Setup's unresolved findings.

The recorded run passed all 463 focused fixture tests. Both native synthetic
scenarios passed: unique PLAIN occurrences retained proven source lines,
repeated occurrences reported `ambiguous_literal`, and patch findings reported
`not_staged_blob`. Every native scenario remained refused with exit 79. The
safe per-finding output is in [result.json](result.json).

## Rollout boundary

The implementation starts at deployed integration base
`bb90b25f456957319a1da44e949f2ea9b748f4cb`. No receiver pin, engine installation,
scanner flag, or trusted fixture row changes in this PR. After source review and
explicit rollout approval, the tooling owner can pin the reviewed engine and
capture one new metadata-only diagnostic for the exact target tuple. That
capture is a new diagnostic observation, not review clearance. If it still
lacks sufficient attribution, report the specific reason and retain the
source-owner qualification gate; do not rewrite product fixtures or retry
unchanged review input repeatedly.

OpenClaw Bay is unaffected: this is bounded host-side failure metadata; no
dashboard, lifecycle, queue, publication, or public data contract changes.

## Validation receipt

- source commit: `9dccbe5432a` (`feat(scan): explain source witness refusals`)
- validated environment: Node `24.22.1`, pnpm `12.4.1`, TruffleHog `3.97.4`
- pinned validation: job `8922fb25`, terminal state `cleanupReady`
- full check: `pnpm run check` passed with exit `0`; receipt root:
  `artifacts/setup130-scan-witness-20261101/cursor-pinned-validation/`
- focused validation: `884` tests passed. The initial zsh `PIPESTATUS`
  wrapper returned exit `1` and is disclosed; the direct focused result passed.
- target observation: the real Setup scan remained refused with exit `79`,
  containing three `ambiguous_literal` and one `unsupported_decoder` reasons.
  No fixture was qualified or admitted from that observation.

The proof is prepared and tested, but not rolled out: no engine pin, receiver
change, scanner flag, trust decision, fixture-policy change, or Setup-target
qualification was made. The safe diagnostic records metadata only and never
publishes raw matches, source text, decoder errors, or large logs. A future
target capture must be treated as a new observation and pass the existing
source-owner qualification gate. The validation job's cleanup/host-failure
metadata does not affect OpenClaw Bay.
