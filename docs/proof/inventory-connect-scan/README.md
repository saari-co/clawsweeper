# Inventory Connect scanner recovery

Claim: the native scanner admits the two synthetic URL-rejection fixtures in
`dinkuskit/inventory#38` while retaining complete source scanning and refusal
for unqualified or verified findings.

Baseline: `0bc99d1eb62737fbeed0c7d5cd4261bb20e16b7d` refuses the complete range
`83a500e09172474dabf4de9cabc76029f7040a99..76bd894b05d90788adb04b2793bdf364ca5ee199`
with `findings`, `literal_not_reviewed`, URI detector 17, PLAIN decoder,
`verified=false`, four findings across the source blob and introduced patch.
The source is `tests/store-connect/protocol.test.mjs`; both values are intentionally
rejected test URLs with placeholder user/password at reserved example/invalid hosts.

The integration merges current upstream main
`openclaw/clawsweeper@ad9ac7f287fdf88e9de0de0ef7913d0c7b0c5e7a` into the deployed
compatibility branch. This includes the upstream scanner and prompt
source-attribution fixes. Two additional exact PLAIN
attributions bind the observed native Raw/RawV2 hashes, complete source lines,
regular-file mode and original test path. There is no target-owned allowlist,
scanner bypass, generic test exemption, or change to verification policy.

Controlled real proof: Linux arm64 Spark-2, Node 24.18.0, native pinned
TruffleHog 3.97.4, candidate engine isolated from the live runtime. Execute:

```text
node docs/proof/agent-input-scan-context/run-proof.mjs <inventory-at-head> \
  83a500e09172474dabf4de9cabc76029f7040a99 \
  76bd894b05d90788adb04b2793bdf364ca5ee199 <output.json>
```

`source-scan-after.json` records admission and four source-attributed notices.
Tests cover additions/removals/context, altered values and lines, wrong paths,
verified findings, wrong decoders, duplicate findings and incomplete scans.
The controlled proof runs no model; a live review must scan its own current
prompt, schema and source again. Product review findings are not cleared here.
OpenClaw Bay is unaffected: this changes host scanner admission only, with no
observer schema, queue or dashboard changes.
