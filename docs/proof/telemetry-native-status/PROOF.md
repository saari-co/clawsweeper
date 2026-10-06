# Review telemetry closeout proof

Source capture matches `14191506e14f622c352cd1c21c44c34eeb1eee49`; later proof-link documentation does not change the captured dashboard source.

- [Browser screenshot](https://github.com/saari-co/swarm-pr-assets/releases/download/clawsweeper-pr-27-14191506e14f/dashboard-race.png): Saari remains selected after the older All response completes. Captured in the actual in-app browser against the actual generated HTML and a controlled loopback HTTP server.
- Image SHA256: `bd3f21272a7ddcc22d437eaf5893f881bb2a30361831887c61062a76a3d54d01`; bytes: 54660. Inspected synthetic data only; no redaction required.
- `browser.json` binds source hash, response order, visible result and immutable asset.
- `result.json` binds the actual publisher CLI and consumer behavior, including different-base separation.
- `transport.json` binds the actual CLI-to-loopback-feeder byte/row-boundary behavior.
- `publication.json` binds the body validator and owning-run cleanup execution.

See [README](README.md) for scenarios and limits. These controlled proofs establish local behavior, not deployment, live tenant correctness, automatic merging or live cleanup.

## Overlay admission environment boundary

The actual workflow admission shell was executed against a synthetic external
JSON overlay and a real temporary `GITHUB_ENV` file. A valid overlay emitted the
two expected values. Embedded newline injection, trailing newline, and NUL inputs
were rejected with a nonzero exit before changing the environment file. The raw
JSON strings are checked before shell substitution can strip trailing newlines.
See [overlay.json](overlay.json) for the workflow hash and final-effect receipts.
This controlled shell proof does not deploy the workflow or access host secrets.
