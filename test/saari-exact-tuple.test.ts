import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseArgs } from "../dist/clawsweeper-args.js";
import {
  exactTupleIdentityFromReviewArgsForTest,
  resolvePreparedMediaProofForTest,
  reviewPromptWithExactTupleForTest,
  skipMediaProofPreprocessingForTest,
} from "../dist/clawsweeper.js";
import { item, readText } from "./helpers.ts";
import { validateSaariExactTupleReport } from "../scripts/validate-saari-exact-tuple-report.mjs";
import {
  SAARI_EXACT_TUPLE_ENGINE_REPOSITORY,
  SAARI_EXACT_TUPLE_WORKFLOW_PATH,
  assertSaariExactTuplePublishBoundary,
  assertTrustedEngineIdentity,
  bindSaariExactTupleIdentity,
  comprehensiveExactTuplePrompt,
  renderExactTupleIdentitySection,
  saariExactTupleArtifactName,
  saariExactTupleTenant,
} from "../dist/saari-exact-tuple.js";

const SUITE = "saari-co/openclaw-smcbd-suite";
const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const CALLEE_SHA = "c".repeat(40);
const CALLER_SHA = "d".repeat(40);

function trustedEngine(overrides: Record<string, string> = {}) {
  return {
    engineSha: CALLEE_SHA,
    trustedEngineSha: CALLEE_SHA,
    trustedEngineRepository: SAARI_EXACT_TUPLE_ENGINE_REPOSITORY,
    trustedEngineFilePath: SAARI_EXACT_TUPLE_WORKFLOW_PATH,
    callerSha: CALLER_SHA,
    ...overrides,
  };
}

function extractStepRunScript(workflow: string, stepName: string): string {
  const header = `- name: ${stepName}`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `missing step ${stepName}`);
  const runStart = workflow.indexOf("run: |\n", start);
  assert.ok(runStart > start, `missing run block for ${stepName}`);
  const next = workflow.slice(runStart + "run: |\n".length);
  const endMatch = next.match(/\n      - |\n  [a-z]/);
  const body = endMatch ? next.slice(0, endMatch.index) : next;
  return body.replace(/^ {10}/gm, "").replace(/\s+$/, "");
}

function runPinnedEngineScript(
  script: string,
  env: Record<string, string>,
): { ok: boolean; stderr: string } {
  try {
    execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        ENGINE_SHA: "",
        ...env,
      },
    });
    return { ok: true, stderr: "" };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: string }).stderr)
        : String(error);
    return { ok: false, stderr };
  }
}

function admitted(overrides: Record<string, unknown> = {}) {
  return {
    repository: SUITE,
    targetRepository: SUITE,
    targetRepositoryId: 1366416798,
    prNumber: 7,
    expectedBaseSha: BASE,
    expectedHeadSha: HEAD,
    reviewEpoch: 3,
    reviewScope: "comprehensive",
    reviewerActor: "saari-clawsweeper",
    ...overrides,
  };
}

function nativeReport(overrides: Record<string, string> = {}) {
  const identity = bindSaariExactTupleIdentity(admitted());
  const fields = {
    number: "7",
    repository: SUITE,
    type: "pull_request",
    review_status: "complete",
    review_terminal_failure: "false",
    local_checkout_access: "verified",
    main_sha: BASE,
    pull_head_sha: HEAD,
    review_epoch: "3",
    review_scope: "comprehensive",
    reviewer_actor: "saari-clawsweeper",
    pr_rating_overall: "B",
    pr_rating_proof: "B",
    real_behavior_proof_status: "sufficient",
    maintainer_decision: '{"required":false,"kind":"none"}',
    ...overrides,
  };
  return [
    "---",
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
    "# Suite PR #7",
    "",
    renderExactTupleIdentitySection(identity),
    "",
    "## Review Findings",
    "",
    "No contributor-facing findings.",
    "",
  ].join("\n");
}

test("tenant config admits only the private suite identity", () => {
  const tenant = saariExactTupleTenant(SUITE);
  assert.equal(tenant.repositoryId, 1366416798);
  assert.equal(tenant.reviewerActor, "saari-clawsweeper");
  assert.equal(tenant.reviewScope, "comprehensive");
  assert.equal(tenant.artifactPrefix, "smcbd-suite-review");
  assert.equal(tenant.publishSideEffects, false);
  assert.throws(() => saariExactTupleTenant("dinkuskit/blocks"), /not an admitted/);
});

test("identity binding rejects repo, id, PR, head, base, epoch, scope, and actor mismatches", () => {
  const identity = bindSaariExactTupleIdentity(admitted());
  assert.equal(identity.reviewerActor, "saari-clawsweeper");
  assert.equal(saariExactTupleArtifactName(801, 1), "smcbd-suite-review-801-1");

  for (const [label, override] of [
    ["repository", { repository: "dinkuskit/blocks", targetRepository: "dinkuskit/blocks" }],
    ["repository id", { targetRepositoryId: 1306882611 }],
    ["PR", { prNumber: 0 }],
    ["head", { expectedHeadSha: "not-a-sha" }],
    ["base", { expectedBaseSha: "NOTA40CHARSHA" }],
    ["epoch", { reviewEpoch: -1 }],
    ["scope", { reviewScope: "P0-only" }],
    ["actor", { reviewerActor: "fixture-suite-clawsweeper" }],
    ["engine", { engineSha: "a".repeat(40), trustedEngineSha: "b".repeat(40) }],
  ] as const) {
    assert.throws(
      () => bindSaariExactTupleIdentity(admitted(override)),
      /admitted|comprehensive|enrolled|trusted|invalid|positive|non-negative|SHA/,
      label,
    );
  }
});

test("caller actor stamps cannot replace the enrolled producer identity", () => {
  const identity = bindSaariExactTupleIdentity(admitted({ reviewerActor: "saari-clawsweeper" }));
  assert.equal(identity.reviewerActor, "saari-clawsweeper");
  assert.throws(
    () => bindSaariExactTupleIdentity(admitted({ reviewerActor: "pr-author" })),
    /enrolled producer identity/,
  );
});

test("native prompt and report carry comprehensive scope, not a frontmatter-only stamp", () => {
  const identity = bindSaariExactTupleIdentity(admitted());
  const prompt = reviewPromptWithExactTupleForTest(
    item({ repo: SUITE, number: 7, kind: "pull_request" }),
    {
      comments: [],
      timeline: [],
      pullFiles: [],
      counts: { comments: 0, timeline: 0, pullFiles: 0 },
    },
    { mainSha: BASE, latestRelease: null },
    identity,
  );
  assert.match(prompt, /Bound exact-tuple review/);
  assert.match(prompt, /Do not narrow the review to P0-only/);
  assert.match(prompt, /P0-P3 reviewFindings/);
  assert.match(prompt, /saari-clawsweeper/);
  assert.doesNotMatch(prompt, /P0-only verdict is PASS/);
  assert.match(comprehensiveExactTuplePrompt(identity), /full applicable native review scope/);

  const args = parseArgs([
    "--review-epoch",
    "3",
    "--review-scope",
    "comprehensive",
    "--reviewer-actor",
    "saari-clawsweeper",
    "--expected-base-sha",
    BASE,
    "--expected-head-sha",
    HEAD,
    "--item-number",
    "7",
    "--target-repository-id",
    "1366416798",
  ]);
  assert.deepEqual(exactTupleIdentityFromReviewArgsForTest(args, SUITE), identity);
  assert.equal(exactTupleIdentityFromReviewArgsForTest(parseArgs([]), SUITE), undefined);
  assert.throws(
    () =>
      exactTupleIdentityFromReviewArgsForTest(
        parseArgs(["--review-scope", "comprehensive"]),
        SUITE,
      ),
    /together/,
  );
});

test("report validator rejects stale, partial, P0-only, and bad-actor reports", () => {
  const dir = mkdtempSync(join(tmpdir(), "saari-exact-tuple-report-"));
  const reportPath = join(dir, "7.md");
  const valid = {
    reportPath,
    repository: SUITE,
    itemNumber: 7,
    baseSha: BASE,
    headSha: HEAD,
    reviewEpoch: "3",
    reviewScope: "comprehensive",
    reviewerActor: "saari-clawsweeper",
  };

  writeFileSync(reportPath, nativeReport());
  assert.equal(validateSaariExactTupleReport(valid).review_scope, "comprehensive");

  writeFileSync(reportPath, nativeReport({ pull_head_sha: "3".repeat(40) }));
  assert.throws(() => validateSaariExactTupleReport(valid), /pull_head_sha/);

  writeFileSync(reportPath, nativeReport({ review_epoch: "8" }));
  assert.throws(() => validateSaariExactTupleReport(valid), /review_epoch/);

  writeFileSync(reportPath, nativeReport({ review_scope: "P0-only" }));
  assert.throws(
    () => validateSaariExactTupleReport(valid),
    /comprehensive|P0-only|admitted review/,
  );

  writeFileSync(reportPath, nativeReport({ reviewer_actor: "clawsweeper" }));
  assert.throws(() => validateSaariExactTupleReport(valid), /reviewer_actor/);

  writeFileSync(reportPath, "not a report\n");
  assert.throws(() => validateSaariExactTupleReport(valid), /frontmatter/);

  mkdirSync(join(dir, "partial"));
  const partialPath = join(dir, "partial", "7.md");
  writeFileSync(partialPath, nativeReport().replace("## Bound Review Identity", "## Missing"));
  assert.throws(
    () => validateSaariExactTupleReport({ ...valid, reportPath: partialPath }),
    /bound identity/,
  );
});

test("reusable producer workflow stays tenant-isolated and artifact-only", () => {
  const workflow = readText(".github/workflows/saari-exact-tuple-review.yml");
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /openclaw-smcbd-suite:1366416798:saari-co\/openclaw-smcbd-suite/);
  assert.match(workflow, /review_scope must be the admitted comprehensive native scope/);
  assert.match(
    workflow,
    /engine_sha must be the trusted defining-workflow commit \(job\.workflow_sha\)/,
  );
  assert.match(workflow, /TRUSTED_ENGINE_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(workflow, /TRUSTED_ENGINE_REPOSITORY: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(workflow, /# job\.workflow_\* is the defining reusable-workflow identity/);
  assert.match(workflow, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(workflow, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(workflow, /TRUSTED_ENGINE_FILE_PATH: \$\{\{ job\.workflow_file_path \}\}/);
  assert.match(workflow, /defining-workflow SHA \(job\.workflow_sha\) is unavailable/);
  assert.match(workflow, /defining-workflow file path \(job\.workflow_file_path\) is unavailable/);
  assert.match(
    workflow,
    /name: smcbd-suite-review-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(workflow, /--review-scope comprehensive/);
  assert.match(workflow, /--reviewer-actor "\$REVIEWER_ACTOR"/);
  assert.match(workflow, /EXACT_REVIEW_WORKFLOW_REPOSITORY="\$TARGET_REPO"/);
  assert.match(workflow, /uses: \.\/clawsweeper\/\.github\/actions\/setup-codex/);
  assert.match(workflow, /core\.hooksPath/);
  assert.match(workflow, /--disable-media-proof-preprocessing/);
  assert.match(workflow, /--readonly-openclaw/);
  assert.match(workflow, /--codex-sandbox read-only/);
  assert.doesNotMatch(workflow, /\$\{\{\s*github\.sha\s*\}\}/);
  assert.doesNotMatch(workflow, /working-directory: .*PRODUCER_TARGET/);
  assert.doesNotMatch(
    workflow,
    /pnpm install --frozen-lockfile --ignore-scripts\n.*PRODUCER_TARGET/,
  );
  assertSaariExactTuplePublishBoundary(workflow);
  assert.doesNotMatch(workflow, /uses: dinkuskit\/clawsweeper/);
});

test("trusted engine identity accepts a distinct caller SHA and rejects it as the pin", () => {
  assert.deepEqual(assertTrustedEngineIdentity(trustedEngine()), {
    engineSha: CALLEE_SHA,
    repository: SAARI_EXACT_TUPLE_ENGINE_REPOSITORY,
    filePath: SAARI_EXACT_TUPLE_WORKFLOW_PATH,
  });
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ engineSha: CALLER_SHA })),
    /defining-workflow commit/,
  );
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ trustedEngineSha: "" })),
    /defining-workflow SHA/,
  );
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ trustedEngineRepository: "" })),
    /defining-workflow repository/,
  );
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ trustedEngineFilePath: "" })),
    /defining-workflow file path/,
  );
  assert.throws(
    () =>
      assertTrustedEngineIdentity(
        trustedEngine({ trustedEngineFilePath: ".github/workflows/sweep.yml" }),
      ),
    /exact-tuple producer/,
  );
});

test("workflow pin script accepts callee SHA and rejects distinct caller SHA", () => {
  const workflow = readText(".github/workflows/saari-exact-tuple-review.yml");
  const first = extractStepRunScript(workflow, "Pin the defining-workflow engine identity");
  const firstStart = workflow.indexOf("- name: Pin the defining-workflow engine identity");
  const second = extractStepRunScript(
    workflow.slice(firstStart + 1),
    "Pin the defining-workflow engine identity",
  );
  assert.equal(first, second);
  assert.match(first, /job\.workflow_sha\) is unavailable/);
  assert.doesNotMatch(first, /github\.sha/);

  const admitted = {
    ENGINE_SHA: CALLEE_SHA,
    TRUSTED_ENGINE_SHA: CALLEE_SHA,
    TRUSTED_ENGINE_REPOSITORY: SAARI_EXACT_TUPLE_ENGINE_REPOSITORY,
    TRUSTED_ENGINE_FILE_PATH: SAARI_EXACT_TUPLE_WORKFLOW_PATH,
    GITHUB_SHA: CALLER_SHA,
  };
  assert.equal(runPinnedEngineScript(first, admitted).ok, true);

  const callerPin = runPinnedEngineScript(first, {
    ...admitted,
    ENGINE_SHA: CALLER_SHA,
  });
  assert.equal(callerPin.ok, false);
  assert.match(callerPin.stderr, /job\.workflow_sha/);

  const missingSha = runPinnedEngineScript(first, {
    ...admitted,
    TRUSTED_ENGINE_SHA: "",
  });
  assert.equal(missingSha.ok, false);
  assert.match(missingSha.stderr, /unavailable/);

  const missingPath = runPinnedEngineScript(first, {
    ...admitted,
    TRUSTED_ENGINE_FILE_PATH: "",
  });
  assert.equal(missingPath.ok, false);
  assert.match(missingPath.stderr, /unavailable/);
});

test("disable-media-proof-preprocessing is a live engine flag, not an inert workflow stamp", () => {
  const dir = mkdtempSync(join(tmpdir(), "saari-media-proof-skip-"));
  const context = {
    issue: {},
    comments: [
      {
        body: "Proof: https://github.com/user/repo/releases/download/proof/demo.mov",
      },
    ],
    timeline: [],
  };
  const throwIfHostPreprocessorRuns = () => {
    throw new Error("host preprocessor must not run");
  };

  assert.equal(skipMediaProofPreprocessingForTest(parseArgs(["--local-only"]), false), false);
  assert.equal(
    skipMediaProofPreprocessingForTest(
      parseArgs(["--local-only", "--disable-media-proof-preprocessing"]),
      false,
    ),
    true,
  );
  assert.equal(skipMediaProofPreprocessingForTest(parseArgs([]), true), true);

  const skipped = resolvePreparedMediaProofForTest(
    context,
    dir,
    skipMediaProofPreprocessingForTest(
      parseArgs(["--local-only", "--disable-media-proof-preprocessing"]),
      false,
    ),
    throwIfHostPreprocessorRuns,
  );
  assert.deepEqual(skipped, { manifestPath: null, summaryPath: null, artifacts: [] });

  const localOnlyStillPrepares = resolvePreparedMediaProofForTest(
    context,
    dir,
    skipMediaProofPreprocessingForTest(parseArgs(["--local-only"]), false),
    (command, args) => {
      if (command === "curl") {
        const outputIndex = args.indexOf("--output");
        writeFileSync(String(args[outputIndex + 1]), "fake mov bytes");
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "ffprobe") {
        return { status: 0, stdout: "{}", stderr: "" };
      }
      if (command === "ffmpeg") {
        writeFileSync(String(args.at(-1)), "fake contact sheet");
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected command: ${command}` };
    },
  );
  assert.equal(localOnlyStillPrepares.artifacts.length, 1);
  assert.equal(localOnlyStillPrepares.artifacts[0]?.status, "prepared");
});
