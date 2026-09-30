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


## Retained integration review corrections

`telemetry-live-proof.json` records the real GitHub check-runs default page
for the pinned upstream commit: 30 returned of 6612 total, now classified
unknown rather than treated as a complete set. Focused consumer tests also
reject action-required, stale, startup-failed and unknown conclusions as CI
success.

`feeder-live-proof.json` records the actual feeder handler using Node 24 native
Fetch against a loopback HTTP server that sends headers and stalls its body.
Two requests return 503 telemetry timeout at the configured 100ms deadline;
the second request proves the timed-out response was not cached. The same
scenario failed before the fix because the body deadline was not enforced.
The regression scenario is in `test/telemetry-feeder.test.ts`.

Limits: no Cloudflare deployment or production request. Current Cloudflare
Workers Fetch/AbortController types and documentation were consulted. Bay's
existing unknown/failure/unavailable values and normalizer are exercised;
there is no observer schema or action-control change.

Final compatibility-boundary proof: `boundary-live-proof.json` records a native
HTTP request into the real dashboard Worker handler. An allowlisted public row
containing controlled private source/executor markers is returned with a fixed
public source label and no executor; neither private marker is present in the
response. The built profile loader accepts explicit empty close rules and rejects
an external profile attempting to add an issue close rule. Repository and owner
fallback negative tests cover both close-rule arrays and malformed/missing rules.
This changes Bay's public projection privacy boundary without changing its schema
or adding action controls. Proof ran in local Node24; no Cloudflare deployment or
live apply/close action was performed.

`priority-count-live-proof.json` exercises the actual native report renderer and
publisher CLI on controlled report fixtures. Native P0/P1/P2/P3 Markdown produces
four total findings and three actionable findings; a P3-only report produces one
total and zero actionable. Unclassified text remains unknown in negative tests.
The proof does not publish state or call GitHub.
