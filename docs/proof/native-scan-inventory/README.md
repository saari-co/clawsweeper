# Native scan inventory behavior proof

[result.json](result.json) contains the actual safe manifests emitted by the compiled review workflow with a synthetic two-finding scanner, plus exit status, provider-call count, diagnostic file inventory and non-disclosure assertions. The command is recorded in the receipt. No raw matches or product input are included. Git blob IDs bind the exercised implementation and tests independently of this proof commit. Nested fixture base/head IDs identify the disposable Git repository.

The native receipt has two entries, zero omissions, exit 79, zero provider calls and one manifest file. The keyed path preserves its existing file contract. Both source coordinates are unavailable because the synthetic raw marker is absent from original blob bytes. The separate late-refusal regression uses a fresh neutral fixture to qualify indices 0–19 and refuses index 20; the inventory retains index 20 first under the count/byte budget. No production trust rows change.

Reproduce on Node 24 using the command in the receipt. This is controlled compiled-path proof, not a live scanner/provider integration or Template27 classification. OpenClaw Bay is unaffected; the changed payload is a private diagnostic artifact.
