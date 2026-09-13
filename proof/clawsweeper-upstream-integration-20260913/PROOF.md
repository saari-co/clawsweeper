# ClawSweeper upstream integration transplant — 2026-09-13

## Claim

The Saari ClawSweeper integration line is rebuilt on current stock upstream
with only the reviewed compatibility overlay and the reviewed dashboard slice.
The over-scoped history-preserving migration (PR 15) is superseded.

## Exact source

- upstream base: `openclaw/clawsweeper@d75f027faca8704bcc220f7ae5127cc93bedaa67`
  (published unchanged as `upstream-pin/d75f027faca8`)
- replayed commits, in order:
  1. `2014a6b246fd893ae88c8679d5e1fbfb056b632a` external repository profile overlays
  2. `ffcf2bdad67fbd958d207f1f72aaf6c7d26298ac` Landlock checkout attestation fallback
  3. `ba19065d3ced7a82b4fcea752f96c8fdaf29d994` unified tenant review dashboard (PR 16 squash)
  4. `77c6fb150ff63a463929b83f86bc7510e83c93c6` fork CI repository-context isolation
- dropped from PR 15: `de58a79eb1d9388650a4e7b682f90cd5c07ce425` (baked-in Saari
  profiles; superseded by the external overlay owned by `saari-co/spark-dgx`)
  and `abe3eb96964a47134658f71d07863fce366eff47` (duplicate of the Landlock
  commit above).

## Conflict resolution

- `src/repository-profiles.ts`: kept upstream's `value-coerce` import and the
  overlay's `readTargetRepositoryConfigSource`; dropped the unused `readFileSync`.
- `README.md`: kept upstream's TruffleHog 3.97.4 text; inserted the Landlock paragraph.
- `test/agent-runner.test.ts`: kept both `codexCheckoutInspectionArgs` and
  upstream's `reviewNetworkCapability` imports.
- Dashboard slice and CI isolation applied without conflicts.

## Proof log

- `pnpm install --frozen-lockfile`, `build`, `build:repair`, `build:dashboard`: passed.
- Focused tests (dashboard observer, profile overlay, agent runner, repository
  profiles): 50 passed, 0 failed.
- Full `pnpm run check`: static checks, all builds, all lint targets, and the
  test matrix passed except two non-regressions:
  - `test/apply-drift-refresh.test.ts`: known host limitation; the fixture
    invokes macOS Bash 3.2, which lacks `mapfile`.
  - `test/github-webhook-read-model.test.ts` ("read model dedupes GUIDs..."):
    reproduces identically on stock upstream `d75f027f` in a clean detached
    worktree with none of the replayed commits; pre-existing upstream issue.
  Neither failing file is touched by this branch.
- Prior PR 16 proof remains valid for the dashboard slice:
  `proof/clawsweeper-dashboard-unification-20260912/PROOF.md`.

## Gates

No merge, deploy, Spark runner pin promotion, Access/App/credential change, or
Review Conductor activation performed. Promoting `clawsweeper-source.json` in
`saari-co/spark-dgx` to this head requires a separate proposal-only Canary and
explicit approval.
