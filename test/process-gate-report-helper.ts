import { parseDecision } from "../dist/clawsweeper.js";
import { closeDecision, item } from "./helpers.ts";
import { markdownFor } from "../dist/clawsweeper-report-document.js";

export function processGateReport(
  overrides: Record<string, unknown> = {},
  body: string | null = null,
) {
  return markdownFor({
    item: item({
      kind: "pull_request",
      repo: "example-org/example-private-suite",
      url: "https://github.com/example-org/example-private-suite/pull/123",
    }),
    decision: {
      ...parseDecision(
        closeDecision({
          decision: "keep_open",
          closeReason: "none",
          ...overrides,
        }),
      ),
      // The host stamps checkout access after parsing model output.
      localCheckoutAccess: "verified",
    },
    context: {
      issue: { body },
      pullRequest: { head: { sha: "c".repeat(40) } },
      comments: [],
      timeline: [],
    },
    git: { mainSha: "a".repeat(40), latestRelease: null, releaseStateComplete: true },
    action: { actionTaken: "kept_open" },
    exactTupleIdentity: {
      repository: "example-org/example-private-suite",
      repositoryId: 1234,
      itemNumber: 123,
      baseSha: "a".repeat(40),
      headSha: "c".repeat(40),
      reviewEpoch: 3,
      reviewScope: "comprehensive",
      reviewerActor: "example-reviewer",
      artifactPrefix: "example-review",
    },
    reviewMode: "propose",
    snapshotHash: "synthetic-snapshot",
    contentDigest: "synthetic-content",
    reviewPolicy: "synthetic-policy",
    runtime: { model: "Codex", reasoningEffort: "high" },
  } as Parameters<typeof markdownFor>[0]);
}
