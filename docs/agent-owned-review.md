# Agent-owned PR review

The coding agent owns comprehensive review dispatch, tracking, and finding
adjudication. Native ClawSweeper and deterministic CI run independently.
Reviews are advisory: queued, running, failed, or missing review completion does
not hold an explicitly owner-authorized merge. Review status must remain visible;
pending or failed review is never clean evidence. CI and other task gates retain
their own contracts, and merge still requires explicit human authorization.

## Dispatch and track

1. Commit and push the intended source. Resolve the PR's actual base branch and
   immutable base/head SHAs; do not assume every PR targets `main`. Check existing
   request IDs and the shared queue before submitting a duplicate generation.
2. Load `smoky-openclaw-autoreview` and perform its SSH and changed-diff media
   preflights. Use the installed `review-tools` package, not copied runner scripts.
3. Materialize the pushed head with the same full base SHA in dry and live calls:

   ```sh
   review-tools materialize --repo <checkout> --ref HEAD --base <base-sha> --dry
   review-tools materialize --repo <checkout> --ref HEAD --base <base-sha>
   ```

4. Use the emitted Spark-2 worktree and immutable base to dispatch comprehensive
   P3 review. Use a non-secret operator ID and increment the review epoch for a
   new source revision. The contract selector names the supported artifact
   protocol; it does not activate the retired Conductor service.

   ```sh
   review-tools openclaw --queue --operator-id <operator> --mode branch \
     --base <base-sha> --remote-worktree <emitted-spark-worktree> \
     --pr-url <pr-url> --engine codex --model gpt-6.1-sol \
     --exact-tuple-contract review-conductor-openclaw-v1 --review-epoch <epoch>
   ```

5. Record the returned request ID and proof path in the PR body immediately.
   Continue other work while queued/running. Query the same request with bounded
   checks rather than dispatching again or cancelling another task's review:

   ```sh
   review-tools openclaw --request-id <request-id> --operator-id <operator>
   ```

6. Update that PR evidence section when terminal evidence arrives. Require
   matching repository/PR/base/head, `review_scope=comprehensive`,
   `native_max_priority=P3`, `applied_max_priority=P3`, and
   `exact_tuple_qualified=true` before calling the review comprehensive.
   Verify the effective reviewer is subscription-backed `gpt-6.1-sol` on Spark-2;
   a model/auth fallback or P0-only receipt must be disclosed, not relabeled as
   the requested review. Review runs host-side; this procedure changes no
   NemoClaw/OpenShell sandbox or credentials.
7. Classify findings as `required_fix`, `reject_false_positive`, `defer`, or
   `human_gate`, with a reason. Fix accepted defects within task authority;
   disclose unresolved findings for the owner's merge decision. After substantive
   source changes, dispatch for the new head and identify older evidence as stale.
   Never alter a receipt to make it match a later commit. If review finishes after
   an authorized merge, update the existing PR evidence and report actionable
   findings to the owner for scoped follow-up; do not amend landed code silently.

## Visible PR evidence

Keep one concise section in the existing PR body; update it instead of adding
repeated progress comments. Include:

- reviewed base/head and current-head match;
- OpenClaw request ID, epoch, state (`queued`, `running`, `completed`, `failed`,
  or `needs-human`), proof path/link, effective model, scope and finding count;
- finding dispositions and any outstanding owner decision;
- native ClawSweeper run and publication evidence, or an explicit pending,
  failed, or ineligible state;
- CI identity/conclusion and changed-behavior proof relevant to the task.

Use a sanitized, accessible tracked proof link when available. A host-local path
can identify a pending artifact but does not make it accessible to GitHub readers.
Do not publish credentials, raw auth logs, or private model transcripts.

## Native review and merge

Observe the current native run; do not trigger another merely because OpenClaw
finished. The current native admission supports eligible non-draft same-repository
PRs targeting `main`. ClawSweeper's `saari-integration` PRs remain ineligible for
that automatic route; agent-owned OpenClaw review uses their explicit base.
Record native ineligibility rather than retargeting a PR or claiming coverage.

Do not add required GitHub review checks, a CI-to-review dependency, a new
scheduler, branch protection, or automatic merge. An authorized merge may proceed
while advisory reviews are pending. Disclose that status in the PR and closeout.

## Upstream inspiration

- [OpenClaw's review-and-publish workflow](https://github.com/openclaw/openclaw/blob/4996ce6e54ab1adafb01dcd9533f614abe4ea4fa/.agents/skills/openclaw-pr-maintainer/SKILL.md#review-and-publish)
  calls for fresh agent review and treats ClawSweeper as advisory, without waiting
  for its comment to land.
- [EmDash's AI policy](https://github.com/emdash-cms/emdash/blob/869563790944651fb596360f96f5c561baf6123b/AI_POLICY.md)
  separates implementation PR review evidence from human maintainer approval.

These are design references, not an assertion that either upstream uses our
Spark queue, exact-tuple protocol, model, or owner-selected merge policy.
