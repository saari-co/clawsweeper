import { parseDecision } from "../dist/clawsweeper.js";
import { closeDecision, item } from "./helpers.ts";
import { createRepositoryLinks } from "../dist/clawsweeper-links.js";
import { createReportDocumentRendering } from "../dist/clawsweeper-report-document.js";
import { createReportContextRendering } from "../dist/clawsweeper-report-context.js";
import { createDashboardPresentation } from "../dist/clawsweeper-dashboard.js";
import { normalizeRepo, repositoryProfileFor } from "../dist/repository-profiles.js";
const evidenceLinks = createRepositoryLinks({
  reportRepo: "openclaw/clawsweeper-state",
  normalizeRepo,
  targetRepo: () => "example-org/example-private-suite",
  targetProfile: () => repositoryProfileFor("openclaw/openclaw"),
});

export function processGateReport(overrides: Record<string, unknown> = {}) {
  const document = createReportDocumentRendering({
    ...evidenceLinks,
    ...createReportContextRendering({} as never),
    ...createDashboardPresentation({} as never),
    prSurfaceFilesFromContext: () => [],
    compactPullFilePaths: () => [],
    confidenceText: String,
    priorityLabel: (value: unknown) => `P${value}`,
    reviewFindingLocation: () => "src/example.ts:1",
    fixedInText: () => "unknown",
    formatTimestamp: String,
    labelJustificationsMarkdown: () => "- none",
    publicLikelyOwnerRole: String,
    pullHeadShaFromContext: () => "c".repeat(40),
    reviewStructuralPullStateFromContext: () => null,
    sentence: String,
    sha256: () => "synthetic-digest",
  } as Parameters<typeof createReportDocumentRendering>[0]);
  return document.markdownFor({
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
    context: { issue: {}, comments: [], timeline: [] },
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
  } as Parameters<typeof document.markdownFor>[0]);
}
