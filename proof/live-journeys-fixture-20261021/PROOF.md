# live-journeys #3 input-fixture qualification

## Scope and source

Target: https://github.com/dinkuskit/live-journeys/pull/3
Base: f112e3e146a5e26700ad54a374ec9ad39b26db0f
Head: a2b7c50b6d12482a6e47f3bc76d69c53e09fe054
Engine source base: cf5737a738793fd435f7df0dca021461078e0a3e
Deployed comparison engine: c121c839be8eb58388ede359a94fba24eba1661a

The head's synthetic userinfo URL and its base-side predecessor belong to the
requestPolicy rejection array in runner/unit/request-policy.test.mjs:16.
The test asserts policy.allows(url) is false. Whole-PR scanning includes the
base-side file, so qualifying only the head would leave a refusal.

The trusted host policy admits only the two exact native identities, their
full source lines, path, regular-file mode, observed PLAIN/HTML/ESCAPED_UNICODE
metadata, and enumerated complete source blobs. No values or raw scanner
output are reproduced here. No blanket synthetic-value exception is added.

## Native behavior proof

Spark-2, Node 24.18.0, pinned TruffleHog 3.97.4. Existing scanAgentInput API,
complete committed source range, controlled harmless prompt, no model.
Raw scanner output and matches are discarded in memory.

- Deployed engine: refused (findings / literal_not_reviewed).
- Candidate: admitted; four classification notices.
- Candidate with an unlisted append to the head file: refused
  (findings / source_not_reviewed), head
  d0169fa65fcd236a984dc9bf1ab7b20c7481e6c4.
- Focused regression tests: 14 pass, no failures; verify exact blob admission,
  missing blob binding, altered verified status, decoder, identity, parts,
  structured metadata, path, line, extra unknown finding, and patch witnesses
  under each explicitly listed decoder.

Machine proof root:
`/home/smoky/Developer/_machine-runs/live-journeys-fixture-a2b7c50/`.
Safe receipts: baseline.json, candidate-v4.json, unlisted-native.json,
focused-final.log. Prior candidate failures are retained as repair history.

## Boundaries and handoff

This is source qualification, not proof of live activation or a native model
review. The installed engine and receiver pins remain unchanged. Product code
and PR history are untouched. The repository requires explicit human merge
approval. After approval, provision the immutable engine and update the native
consumer pins through their owner, then send the one requested
`@clawsweeper review` comment. Never describe that request as clearance.

Full check and comprehensive source-review outcomes belong in the PR evidence
section, tied to the source head that actually ran.
