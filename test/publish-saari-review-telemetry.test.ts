import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeTenantFeed } from "../dashboard/unified-review-dashboard.ts";
import {
  buildSaariReviewTelemetry,
  CLAWSWEEPER_RANKS,
  parsePublisherArgs,
  SAARI_LANE,
  writeSaariReviewTelemetry,
} from "../scripts/telemetry/publish-saari-review-telemetry.mjs";

const NOW = Date.parse("2026-09-13T18:00:00Z");
const HEAD = "b".repeat(40);
const BASE = "a".repeat(40);
const ENGINE = "c".repeat(40);
const SCRIPT = fileURLToPath(
  new URL("../scripts/telemetry/publish-saari-review-telemetry.mjs", import.meta.url),
);

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), "saari-review-telemetry-"));
}

function writeDoneRecord(root: string, overrides: Record<string, unknown> = {}) {
  const doneDir = join(root, "done");
  mkdirSync(doneDir, { recursive: true });
  const record = {
    submitted_head: HEAD,
    commit_sha: HEAD,
    pr_url: "https://github.com/saari-co/x-api/pull/44",
    review_clean: true,
    review_finding_count: 0,
    review_summary: "clean",
    status: "completed",
    exit_code: 0,
    repo: "saari-co/x-api",
    submitted_at_utc: "2026-09-13T17:50:00Z",
    proof_path: "proof/dgx-openclaw-review-x-api-44/PROOF.md",
    ...overrides,
  };
  writeFileSync(join(doneDir, "req-44.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function writeRunningRecord(root: string) {
  const runningDir = join(root, "running");
  mkdirSync(runningDir, { recursive: true });
  writeFileSync(
    join(runningDir, "req-99.json"),
    `${JSON.stringify({
      submitted_head: "d".repeat(40),
      pr_url: "https://github.com/saari-co/x-api/pull/99",
      status: "running",
      repo: "saari-co/x-api",
      submitted_at_utc: "2026-09-13T17:58:00Z",
    })}\n`,
  );
}

function writeItemArtifact(
  root: string,
  overrides: { verdict?: string; rating?: string; findings?: string; sha?: string } = {},
) {
  const itemsDir = join(root, "items", "saari-co-x-api");
  mkdirSync(itemsDir, { recursive: true });
  const sha = overrides.sha ?? HEAD;
  const verdict = overrides.verdict ?? "pass";
  const rating = overrides.rating ?? "B";
  const findings =
    overrides.findings ??
    `## Review Findings

- none
`;
  writeFileSync(
    join(itemsDir, "44.md"),
    `---
number: 44
repository: saari-co/x-api
type: pull_request
url: https://github.com/saari-co/x-api/pull/44
reviewed_at: 2026-09-13T17:55:00Z
main_sha: ${BASE}
pull_head_sha: ${sha}
review_status: complete
decision: keep_open
pr_rating_overall: ${rating}
proof_path: proof/dgx-clawsweeper-sweep-saari-co-x-api-20260913T175500Z/PROOF.md
---

# #44: sample

<!-- clawsweeper-verdict:${verdict} item=44 sha=${sha} confidence=high -->

${findings}
`,
  );
}

function publish(options: {
  queueRoot: string;
  reviewRoot: string;
  ciSource?: "none" | "gh";
  ghExec?: (repository: string, headSha: string) => unknown;
}) {
  return buildSaariReviewTelemetry({
    openclawQueueRoot: options.queueRoot,
    reviewStateRoot: options.reviewRoot,
    engineSha: ENGINE,
    executor: "spark-2",
    ciSource: options.ciSource ?? "none",
    staleAfterSeconds: 900,
    now: NOW,
    ghExec: options.ghExec,
  });
}

test("publishes the official rank ladder strings", () => {
  assert.deepEqual(CLAWSWEEPER_RANKS, [
    "S Challenger Crab",
    "A Diamond Lobster",
    "B Platinum Hermit",
    "C Gold Shrimp",
    "D Silver Shellfish",
    "F Unranked Krab",
    "N/A Off-meta Tidepool",
  ]);
});

test("merged OpenClaw and ClawSweeper fixtures produce a consumer-valid envelope", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeDoneRecord(queueRoot);
  writeItemArtifact(reviewRoot);
  const envelope = publish({ queueRoot, reviewRoot });
  const normalized = normalizeTenantFeed("saari", envelope, NOW);
  assert.equal(normalized.projection.status, "available");
  assert.deepEqual(normalized.projection.lane, SAARI_LANE);
  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.rows[0]?.openclaw, "success");
  assert.equal(normalized.rows[0]?.clawsweeper, "success");
  assert.equal(normalized.rows[0]?.rating, "B Platinum Hermit");
  assert.equal(normalized.rows[0]?.ci, "unknown");
  assert.deepEqual(normalized.rows[0]?.proof_links, [
    "https://github.com/saari-co/x-api/pull/44",
    "https://github.com/saari-co/spark-dgx/blob/main/proof/dgx-openclaw-review-x-api-44/PROOF.md",
    "https://github.com/saari-co/spark-dgx/blob/main/proof/dgx-clawsweeper-sweep-saari-co-x-api-20260913T175500Z/PROOF.md",
  ]);
});

test("absent ClawSweeper artifact stays unknown and is never success", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeDoneRecord(queueRoot);
  const envelope = publish({ queueRoot, reviewRoot });
  const normalized = normalizeTenantFeed("saari", envelope, NOW);
  assert.equal(normalized.rows[0]?.clawsweeper, "unknown");
  assert.equal(normalized.rows[0]?.rating, null);
  assert.notEqual(normalized.rows[0]?.clawsweeper, "success");
});

test("absent OpenClaw record stays unknown and is never success", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeItemArtifact(reviewRoot);
  const envelope = publish({ queueRoot, reviewRoot });
  const normalized = normalizeTenantFeed("saari", envelope, NOW);
  assert.equal(normalized.rows[0]?.openclaw, "unknown");
  assert.notEqual(normalized.rows[0]?.openclaw, "success");
  assert.equal(normalized.rows[0]?.clawsweeper, "success");
});

test("completed without review_clean does not infer OpenClaw success", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeDoneRecord(queueRoot, {
    review_clean: undefined,
    review_finding_count: undefined,
    exit_code: 0,
  });
  const envelope = publish({ queueRoot, reviewRoot });
  const normalized = normalizeTenantFeed("saari", envelope, NOW);
  assert.equal(normalized.rows[0]?.openclaw, "unknown");
});

test("completed with findings is an explicit OpenClaw failure", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeDoneRecord(queueRoot, { review_clean: false, review_finding_count: 2, exit_code: 1 });
  const envelope = publish({ queueRoot, reviewRoot });
  const normalized = normalizeTenantFeed("saari", envelope, NOW);
  assert.equal(normalized.rows[0]?.openclaw, "failure");
});

test("running OpenClaw records stay running", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeRunningRecord(queueRoot);
  const envelope = publish({ queueRoot, reviewRoot });
  const normalized = normalizeTenantFeed("saari", envelope, NOW);
  assert.equal(normalized.rows[0]?.openclaw, "running");
  assert.equal(normalized.rows[0]?.pr_number, 99);
});

test("records without an exact head are omitted", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeDoneRecord(queueRoot, { submitted_head: "short", commit_sha: "also-short" });
  const envelope = publish({ queueRoot, reviewRoot });
  assert.deepEqual(envelope.rows, []);
  const normalized = normalizeTenantFeed("saari", envelope, NOW);
  assert.equal(normalized.projection.status, "available");
  assert.equal(normalized.projection.row_count, 0);
});

test("proof links stay https-only and never include tokens or local paths", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeDoneRecord(queueRoot, {
    pr_url: "https://github.com/saari-co/x-api/pull/44",
    proof_path: "/tmp/secret-proof.md",
    token: "ghs_must_never_escape",
  });
  const envelope = publish({ queueRoot, reviewRoot });
  const serialized = JSON.stringify(envelope);
  assert.deepEqual(envelope.rows[0]?.proof_links, ["https://github.com/saari-co/x-api/pull/44"]);
  assert.doesNotMatch(
    serialized,
    /ghs_must_never_escape|\/tmp\/secret-proof|TELEMETRY_SOURCE_TOKEN|HOME=/,
  );
});

test("gh check-runs populate explicit CI conclusions and empty checks stay unknown", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  writeDoneRecord(queueRoot);
  const success = publish({
    queueRoot,
    reviewRoot,
    ciSource: "gh",
    ghExec: () => ({
      check_runs: [{ status: "completed", conclusion: "success" }],
    }),
  });
  assert.equal(normalizeTenantFeed("saari", success, NOW).rows[0]?.ci, "success");

  const empty = publish({
    queueRoot,
    reviewRoot,
    ciSource: "gh",
    ghExec: () => ({ check_runs: [] }),
  });
  assert.equal(normalizeTenantFeed("saari", empty, NOW).rows[0]?.ci, "unknown");
});

test("CLI writes the envelope to --out", () => {
  const queueRoot = fixtureRoot();
  const reviewRoot = fixtureRoot();
  const out = join(fixtureRoot(), "results", "review-telemetry", "saari.json");
  writeDoneRecord(queueRoot);
  writeItemArtifact(reviewRoot);
  const result = spawnSync(process.execPath, [
    SCRIPT,
    "--openclaw-queue-root",
    queueRoot,
    "--review-state-root",
    reviewRoot,
    "--engine-sha",
    ENGINE,
    "--executor",
    "spark-2",
    "--ci-source",
    "none",
    "--stale-after-seconds",
    "900",
    "--out",
    out,
  ]);
  assert.equal(result.status, 0, result.stderr.toString());
  const written = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(
    normalizeTenantFeed("saari", written, Date.parse(written.generated_at)).projection.status,
    "available",
  );
});

test("write helper and arg parser reject unsafe inputs", () => {
  assert.throws(() => parsePublisherArgs([]), /--out is required/);
  assert.throws(() => parsePublisherArgs(["--out", "x", "--ci-source", "write"]), /none or gh/);
  const out = join(fixtureRoot(), "saari.json");
  writeSaariReviewTelemetry({
    openclawQueueRoot: fixtureRoot(),
    reviewStateRoot: fixtureRoot(),
    engineSha: ENGINE,
    executor: "spark-2",
    ciSource: "none",
    staleAfterSeconds: 900,
    out,
    now: NOW,
  });
  const written = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(written.tenant, "saari");
  assert.deepEqual(written.rows, []);
});
