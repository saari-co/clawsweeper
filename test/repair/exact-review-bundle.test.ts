import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createExactReviewBundle,
  exactReviewDecisionSha256,
  validateExactReviewBundle,
  zipExactReviewBundle,
} from "../../dist/repair/exact-review-bundle.js";

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const ENGINE = "a".repeat(40);

function context(overrides: Record<string, unknown> = {}) {
  return {
    repository: "saari-co/openclaw-smcbd-suite",
    sourceSha: ENGINE,
    runId: "801",
    runAttempt: 1,
    producerJob: "review",
    decisionSha256: exactReviewDecisionSha256(
      JSON.stringify({
        base_sha: BASE,
        engine_sha: ENGINE,
        head_sha: HEAD,
        item_number: 7,
        review_epoch: 3,
        review_scope: "comprehensive",
        reviewer_actor: "saari-clawsweeper",
        target_repo: "saari-co/openclaw-smcbd-suite",
      }),
    ),
    targetRepo: "saari-co/openclaw-smcbd-suite",
    targetBranch: "main",
    itemNumber: 7,
    itemKind: "pull_request" as const,
    itemKey: "saari-co/openclaw-smcbd-suite#7",
    protocolVersion: 1 as const,
    leaseRevision: null,
    claimGeneration: null,
    liveProceeded: true,
    liveTerminalNoop: false,
    liveTerminalMissing: false,
    liveGuardedOpen: false,
    ...overrides,
  };
}

test("exact review bundle emits only manifest.json and the review report", () => {
  const root = mkdtempSync(join(tmpdir(), "saari-exact-bundle-"));
  const reportPath = join(root, "7.md");
  writeFileSync(reportPath, "# review\n");
  const bundleDir = join(root, "bundle");
  const manifest = createExactReviewBundle({
    bundleDir,
    reviewPath: reportPath,
    createdAt: "2026-09-13T12:00:00.000Z",
    context: context(),
  });
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    ["review/7.md"],
  );
  assert.equal(manifest.review.artifact_present, true);
  assert.equal(manifest.workflow.run_id, "801");
  validateExactReviewBundle(bundleDir, context());
  const zip = zipExactReviewBundle(bundleDir);
  assert.ok(zip.length > 0);
});

test("exact review bundle rejects ledger files, stale context, and missing reports", () => {
  const root = mkdtempSync(join(tmpdir(), "saari-exact-bundle-reject-"));
  const reportPath = join(root, "7.md");
  writeFileSync(reportPath, "# review\n");
  const bundleDir = join(root, "bundle");
  createExactReviewBundle({
    bundleDir,
    reviewPath: reportPath,
    createdAt: "2026-09-13T12:00:00.000Z",
    context: context(),
  });
  mkdirSync(join(bundleDir, "action-ledger"), { recursive: true });
  writeFileSync(join(bundleDir, "action-ledger", "ledger.md"), "nope\n");
  assert.throws(() => validateExactReviewBundle(bundleDir, context()), /unexpected path|inventory/);

  assert.throws(
    () =>
      createExactReviewBundle({
        bundleDir: join(root, "missing"),
        createdAt: "2026-09-13T12:00:00.000Z",
        context: context(),
      }),
    /requires a review artifact/,
  );

  assert.throws(
    () =>
      createExactReviewBundle({
        bundleDir: join(root, "stale"),
        reviewPath: reportPath,
        createdAt: "2026-09-13T12:00:00.000Z",
        context: context({ targetRepo: "dinkuskit/blocks" }),
      }),
    /item key does not match the target/,
  );
});
