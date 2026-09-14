import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseArgs } from "../dist/clawsweeper-args.js";
import { reviewPromptForTest } from "../dist/clawsweeper.js";
import {
  resolvePreparedMediaProofForTest,
  skipMediaProofPreprocessingForTest,
} from "../dist/clawsweeper-media-proof.js";
import { item, readText } from "./helpers.ts";
import { validateSaariExactTupleReport } from "../scripts/validate-saari-exact-tuple-report.mjs";
import {
  EXACT_TUPLE_CONFIG_ENV,
  EXACT_TUPLE_WORKFLOW_PATH,
  SAARI_SPARK_CODEX_HOME_RELATIVE,
  SAARI_SPARK_CODEX_MODEL_ALIAS,
  SAARI_SPARK_COMMAND_LOCK_RELATIVE,
  SAARI_SPARK_LOGIN_METHOD,
  assertSaariExactTuplePublishBoundary,
  assertActionsCheckoutPathUnderWorkspace,
  assertSaariSparkHostReuseContract,
  assertSaariSparkNoApiCredentialSetup,
  assertSaariSparkNoGlobalAuthWrites,
  assertTrustedEngineIdentity,
  bindSaariExactTupleIdentity,
  comprehensiveExactTuplePrompt,
  exactTupleIdentityFromReviewArgs,
  isActionsCheckoutPathUnderWorkspace,
  parseExactTupleConfig,
  prepareSaariSparkExactTupleRun,
  renderExactTupleIdentitySection,
  resolveSaariSparkKnownExecutable,
  saariExactTupleArtifactName,
  saariExactTupleTenant,
  saariSparkCodexHomePath,
  saariSparkCommandLockPath,
  saariSparkIsolatedPaths,
} from "../dist/saari-exact-tuple.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OVERLAY_PATH = join(REPO_ROOT, "test", "fixtures", "saari-exact-tuple-overlay.json");
const SUITE = "example-org/example-private-suite";
const ENGINE_REPO = "saari-co/clawsweeper";
const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const CALLEE_SHA = "c".repeat(40);
const CALLER_SHA = "d".repeat(40);
const CONFIG = parseExactTupleConfig(readFileSync(OVERLAY_PATH, "utf8"));

function trustedEngine(overrides: Record<string, string> = {}) {
  return {
    engineSha: CALLEE_SHA,
    trustedEngineSha: CALLEE_SHA,
    trustedEngineRepository: ENGINE_REPO,
    trustedEngineFilePath: EXACT_TUPLE_WORKFLOW_PATH,
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
    targetRepositoryId: 1000000001,
    prNumber: 7,
    expectedBaseSha: BASE,
    expectedHeadSha: HEAD,
    reviewEpoch: 3,
    reviewScope: "comprehensive",
    reviewerActor: "example-reviewer-bot",
    ...overrides,
  };
}

function nativeReport(overrides: Record<string, string> = {}) {
  const identity = bindSaariExactTupleIdentity(admitted(), CONFIG);
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
    reviewer_actor: "example-reviewer-bot",
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

test("tenant config is required from the external overlay, not the engine", () => {
  assert.throws(() => saariExactTupleTenant(SUITE), new RegExp(EXACT_TUPLE_CONFIG_ENV));
  const tenant = saariExactTupleTenant(SUITE, CONFIG);
  assert.equal(tenant.repositoryId, 1000000001);
  assert.equal(tenant.reviewerActor, "example-reviewer-bot");
  assert.equal(tenant.reviewScope, "comprehensive");
  assert.equal(tenant.artifactPrefix, "example-suite-review");
  assert.equal(tenant.publishSideEffects, false);
  assert.throws(
    () => saariExactTupleTenant("example-org/unrelated-repo", CONFIG),
    /not an admitted/,
  );
});

test("identity binding rejects repo, id, PR, head, base, epoch, scope, and actor mismatches", () => {
  const identity = bindSaariExactTupleIdentity(admitted(), CONFIG);
  assert.equal(identity.reviewerActor, "example-reviewer-bot");
  assert.equal(
    saariExactTupleArtifactName(identity.artifactPrefix, 801, 1),
    "example-suite-review-801-1",
  );

  for (const [label, override] of [
    [
      "repository",
      { repository: "example-org/unrelated-repo", targetRepository: "example-org/unrelated-repo" },
    ],
    ["repository id", { targetRepositoryId: 1000000002 }],
    ["PR", { prNumber: 0 }],
    ["head", { expectedHeadSha: "not-a-sha" }],
    ["base", { expectedBaseSha: "NOTA40CHARSHA" }],
    ["epoch", { reviewEpoch: -1 }],
    ["scope", { reviewScope: "P0-only" }],
    ["actor", { reviewerActor: "fixture-suite-clawsweeper" }],
    ["engine", { engineSha: "a".repeat(40), trustedEngineSha: "b".repeat(40) }],
  ] as const) {
    assert.throws(
      () => bindSaariExactTupleIdentity(admitted(override), CONFIG),
      /admitted|comprehensive|enrolled|trusted|invalid|positive|non-negative|SHA/,
      label,
    );
  }
});

test("caller actor stamps cannot replace the enrolled producer identity", () => {
  const identity = bindSaariExactTupleIdentity(
    admitted({ reviewerActor: "example-reviewer-bot" }),
    CONFIG,
  );
  assert.equal(identity.reviewerActor, "example-reviewer-bot");
  assert.throws(
    () => bindSaariExactTupleIdentity(admitted({ reviewerActor: "pr-author" }), CONFIG),
    /enrolled producer identity/,
  );
});

test("native prompt and report carry comprehensive scope, not a frontmatter-only stamp", () => {
  const identity = bindSaariExactTupleIdentity(admitted(), CONFIG);
  const prompt = reviewPromptForTest(
    item({ repo: "openclaw/clawsweeper", number: 7, kind: "pull_request" }),
    {
      comments: [],
      timeline: [],
      pullFiles: [],
      counts: { comments: 0, timeline: 0, pullFiles: 0 },
    },
    { mainSha: BASE, releaseStateComplete: true, latestRelease: null },
    "",
    { exactTuplePrompt: comprehensiveExactTuplePrompt(identity) },
  );
  assert.match(prompt, /Bound exact-tuple review/);
  assert.match(prompt, /Do not narrow the review to P0-only/);
  assert.match(prompt, /P0-P3 reviewFindings/);
  assert.match(prompt, /example-reviewer-bot/);
  assert.doesNotMatch(prompt, /P0-only verdict is PASS/);
  assert.match(comprehensiveExactTuplePrompt(identity), /full applicable native review scope/);

  const args = parseArgs([
    "--review-epoch",
    "3",
    "--review-scope",
    "comprehensive",
    "--reviewer-actor",
    "example-reviewer-bot",
    "--expected-base-sha",
    BASE,
    "--expected-head-sha",
    HEAD,
    "--item-number",
    "7",
    "--target-repository-id",
    "1000000001",
  ]);
  assert.deepEqual(exactTupleIdentityFromReviewArgs(args, SUITE, CONFIG), identity);
  assert.equal(exactTupleIdentityFromReviewArgs(parseArgs([]), SUITE, CONFIG), undefined);
  assert.throws(
    () =>
      exactTupleIdentityFromReviewArgs(
        parseArgs(["--review-scope", "comprehensive"]),
        SUITE,
        CONFIG,
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
    reviewerActor: "example-reviewer-bot",
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

test("reusable producer workflow stays overlay-bound and artifact-only", () => {
  const workflow = readText(".github/workflows/saari-exact-tuple-review.yml");
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\nschedule:/);
  assert.doesNotMatch(workflow, /example-org\/example-private-suite/);
  assert.doesNotMatch(workflow, /1000000001/);
  assert.doesNotMatch(workflow, /example-reviewer-bot/);
  assert.doesNotMatch(workflow, /example-suite-review/);
  assert.match(workflow, /CLAWSWEEPER_EXACT_TUPLE_CONFIG/);
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
  assert.match(workflow, /name: \$\{\{ env\.EXACT_TUPLE_ARTIFACT_NAME \}\}/);
  assert.match(workflow, /--review-scope comprehensive/);
  assert.match(workflow, /--reviewer-actor "\$REVIEWER_ACTOR"/);
  assert.match(workflow, /EXACT_REVIEW_WORKFLOW_REPOSITORY="\$TARGET_REPO"/);
  assert.match(workflow, /core\.hooksPath/);
  assert.match(workflow, /--disable-media-proof-preprocessing/);
  assert.match(workflow, /--readonly-openclaw/);
  assert.match(workflow, /--codex-sandbox read-only/);
  assert.match(
    workflow,
    /path: saari-exact-tuple-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\/checkout/,
  );
  assert.match(workflow, /set-safe-directory: false/);
  assert.match(
    workflow,
    /working-directory: \$\{\{ github\.workspace \}\}\/saari-exact-tuple-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\/checkout/,
  );
  assert.doesNotMatch(workflow, /\$\{\{\s*github\.sha\s*\}\}/);
  assert.doesNotMatch(workflow, /working-directory: .*PRODUCER_TARGET/);
  assert.doesNotMatch(
    workflow,
    /pnpm install --frozen-lockfile --ignore-scripts\n.*PRODUCER_TARGET/,
  );
  assertSaariExactTuplePublishBoundary(workflow);
  assertSaariSparkHostReuseContract(workflow);
  assert.doesNotMatch(workflow, /uses: dinkuskit\/clawsweeper/);
});

test("trusted engine identity accepts a distinct caller SHA and rejects it as the pin", () => {
  assert.deepEqual(assertTrustedEngineIdentity(trustedEngine(), CONFIG), {
    engineSha: CALLEE_SHA,
    repository: ENGINE_REPO,
    filePath: EXACT_TUPLE_WORKFLOW_PATH,
  });
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ engineSha: CALLER_SHA }), CONFIG),
    /defining-workflow commit/,
  );
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ trustedEngineSha: "" }), CONFIG),
    /defining-workflow SHA/,
  );
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ trustedEngineRepository: "" }), CONFIG),
    /defining-workflow repository/,
  );
  assert.throws(
    () => assertTrustedEngineIdentity(trustedEngine({ trustedEngineFilePath: "" }), CONFIG),
    /defining-workflow file path/,
  );
  assert.throws(
    () =>
      assertTrustedEngineIdentity(
        trustedEngine({ trustedEngineFilePath: ".github/workflows/sweep.yml" }),
        CONFIG,
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

  const admittedPin = {
    ENGINE_SHA: CALLEE_SHA,
    TRUSTED_ENGINE_SHA: CALLEE_SHA,
    TRUSTED_ENGINE_REPOSITORY: ENGINE_REPO,
    TRUSTED_ENGINE_FILE_PATH: EXACT_TUPLE_WORKFLOW_PATH,
    GITHUB_SHA: CALLER_SHA,
  };
  assert.equal(runPinnedEngineScript(first, admittedPin).ok, true);

  const callerPin = runPinnedEngineScript(first, {
    ...admittedPin,
    ENGINE_SHA: CALLER_SHA,
  });
  assert.equal(callerPin.ok, false);
  assert.match(callerPin.stderr, /job\.workflow_sha/);

  const missingSha = runPinnedEngineScript(first, {
    ...admittedPin,
    TRUSTED_ENGINE_SHA: "",
  });
  assert.equal(missingSha.ok, false);
  assert.match(missingSha.stderr, /unavailable/);

  const missingPath = runPinnedEngineScript(first, {
    ...admittedPin,
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

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function fakeSparkHome(): {
  home: string;
  runnerTemp: string;
  githubWorkspace: string;
  envFile: string;
} {
  const root = mkdtempSync(join(tmpdir(), "saari-spark-home-"));
  const home = join(root, "home");
  const runnerTemp = join(root, "runner-temp");
  const githubWorkspace = join(root, "workspace");
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  mkdirSync(join(home, ".config", "clawsweeper", "codex-home"), { recursive: true });
  mkdirSync(runnerTemp, { recursive: true });
  mkdirSync(githubWorkspace, { recursive: true });
  writeFileSync(join(home, ".config", "clawsweeper", "codex-home", "auth.json"), "");
  for (const name of ["node", "gh", "codex", "corepack", "flock"]) {
    writeExecutable(
      join(home, ".local", "bin", name),
      name === "node" ? "#!/bin/sh\necho 24\n" : "#!/bin/sh\nexit 0\n",
    );
  }
  return { home, runnerTemp, githubWorkspace, envFile: join(root, "github.env") };
}

test("Spark subscription reuse rejects API setup and host auth writes", () => {
  const workflow = readText(".github/workflows/saari-exact-tuple-review.yml");
  assertSaariSparkNoApiCredentialSetup(workflow);
  assertSaariSparkNoGlobalAuthWrites(workflow);
  assert.match(workflow, /CLAWSWEEPER_CODEX_LOGIN_METHOD: chatgpt/);
  assert.match(workflow, /--codex-forced-login-method chatgpt/);
  assert.match(workflow, /--codex-model internal/);
  assert.match(workflow, /runs-on: \[self-hosted, spark-2\]/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /setup-codex/);
  assert.doesNotMatch(workflow, /secrets\.OPENAI_API_KEY/);
  assert.doesNotMatch(workflow, /secrets\.CLAWSWEEPER_MODEL/);
  assert.throws(
    () => assertSaariSparkNoApiCredentialSetup("uses: ./clawsweeper/.github/actions/setup-codex"),
    /API credential setup/,
  );
  assert.throws(
    () => assertSaariSparkNoGlobalAuthWrites('cp "$CODEX_HOME/auth.json" /tmp/auth.json'),
    /write host auth/,
  );
});

test("Spark isolated paths keep the shared lock and reject host checkout reuse", () => {
  const fake = fakeSparkHome();
  const paths = saariSparkIsolatedPaths({
    runnerTemp: fake.runnerTemp,
    githubWorkspace: fake.githubWorkspace,
    runId: "801",
    runAttempt: "2",
  });
  const lockFile = saariSparkCommandLockPath(fake.home);
  const prepared = prepareSaariSparkExactTupleRun({
    identity: admitted(),
    engine: trustedEngine(),
    host: {
      home: fake.home,
      runnerTemp: fake.runnerTemp,
      githubWorkspace: fake.githubWorkspace,
      runId: "801",
      runAttempt: "2",
      env: { PATH: join(fake.home, ".local", "bin") },
    },
    config: CONFIG,
  });
  assert.equal(paths.checkout, join(fake.githubWorkspace, "saari-exact-tuple-801-2", "checkout"));
  assert.equal(paths.engine, join(fake.runnerTemp, "saari-exact-tuple-801-2", "engine"));
  assert.equal(lockFile, join(fake.home, SAARI_SPARK_COMMAND_LOCK_RELATIVE));
  assert.equal(prepared.codexHome, join(fake.home, SAARI_SPARK_CODEX_HOME_RELATIVE));
  assert.equal(prepared.lockFile, lockFile);
  assert.equal(prepared.loginMethod, SAARI_SPARK_LOGIN_METHOD);
  assert.equal(prepared.modelAlias, SAARI_SPARK_CODEX_MODEL_ALIAS);
  assert.equal(prepared.executables.codex, join(fake.home, ".local", "bin", "codex"));
  assert.ok(!lockFile.startsWith(paths.runRoot));
  assert.ok(!prepared.codexHome.startsWith(paths.runRoot));
  assert.doesNotMatch(paths.target, /\.cache\/clawsweeper\/targets/);
  assert.throws(
    () =>
      resolveSaariSparkKnownExecutable("codex", {
        home: join(fake.home, "empty"),
        env: { PATH: "/no-such-spark-bin" },
      }),
    /absent from known paths/,
  );
  assert.throws(
    () =>
      resolveSaariSparkKnownExecutable("codex", {
        home: fake.home,
        env: { CODEX_BIN: join(fake.home, "missing-codex") },
      }),
    /not an executable/,
  );
});

test("official checkout containment admits unique workspace path and rejects runner temp", () => {
  const githubWorkspace = "/home/runner/work/clawsweeper/clawsweeper";
  const runnerTemp = "/home/runner/work/_temp";
  const relativeCheckout = "saari-exact-tuple-801-2/checkout";
  const workspaceCheckout = `${githubWorkspace}/${relativeCheckout}`;
  const runnerTempCheckout = `${runnerTemp}/saari-exact-tuple-801-2/checkout`;

  assert.equal(isActionsCheckoutPathUnderWorkspace(relativeCheckout, githubWorkspace), true);
  assert.equal(isActionsCheckoutPathUnderWorkspace(workspaceCheckout, githubWorkspace), true);
  assert.equal(
    assertActionsCheckoutPathUnderWorkspace(relativeCheckout, githubWorkspace),
    workspaceCheckout,
  );
  assert.equal(isActionsCheckoutPathUnderWorkspace(runnerTempCheckout, githubWorkspace), false);
  assert.throws(
    () => assertActionsCheckoutPathUnderWorkspace(runnerTempCheckout, githubWorkspace),
    /Repository path '\/home\/runner\/work\/_temp\/saari-exact-tuple-801-2\/checkout' is not under '\/home\/runner\/work\/clawsweeper\/clawsweeper'/,
  );

  const paths = saariSparkIsolatedPaths({
    githubWorkspace,
    runnerTemp,
    runId: "801",
    runAttempt: "2",
  });
  assert.equal(paths.checkout, workspaceCheckout);
  assert.equal(paths.engine, `${runnerTemp}/saari-exact-tuple-801-2/engine`);
  assert.equal(paths.target, `${runnerTemp}/saari-exact-tuple-801-2/target`);
  assert.equal(paths.emptyState, `${runnerTemp}/saari-exact-tuple-801-2/empty-state`);
  assert.equal(paths.artifacts, `${runnerTemp}/saari-exact-tuple-801-2/review-artifacts`);
  assert.equal(isActionsCheckoutPathUnderWorkspace(paths.checkout, githubWorkspace), true);
  assert.equal(isActionsCheckoutPathUnderWorkspace(paths.engine, githubWorkspace), false);

  const workflow = readText(".github/workflows/saari-exact-tuple-review.yml");
  const isolate = extractStepRunScript(workflow, "Isolate unique per-run producer paths");
  const fake = fakeSparkHome();
  const isolated = runPinnedEngineScript(isolate, {
    GITHUB_WORKSPACE: fake.githubWorkspace,
    RUNNER_TEMP: fake.runnerTemp,
    GITHUB_RUN_ID: "801",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_ENV: fake.envFile,
  });
  assert.equal(isolated.ok, true);
  const envText = readText(fake.envFile);
  assert.match(
    envText,
    new RegExp(`PRODUCER_CHECKOUT=${fake.githubWorkspace}/saari-exact-tuple-801-2/checkout`),
  );
  assert.match(
    envText,
    new RegExp(`PRODUCER_ENGINE=${fake.runnerTemp}/saari-exact-tuple-801-2/engine`),
  );
  assert.doesNotMatch(envText, /PRODUCER_CHECKOUT=.*runner-temp/);

  const missingWorkspace = runPinnedEngineScript(isolate, {
    GITHUB_WORKSPACE: "",
    RUNNER_TEMP: fake.runnerTemp,
    GITHUB_RUN_ID: "801",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_ENV: fake.envFile,
  });
  assert.equal(missingWorkspace.ok, false);
  assert.match(missingWorkspace.stderr, /GITHUB_WORKSPACE is unavailable/);
});

test("exact identity mismatches reject before any Spark host work", () => {
  const hostTouched = (): boolean => {
    throw new Error("host work started");
  };
  const host = {
    home: "/should-not-touch",
    runnerTemp: "/should-not-touch",
    githubWorkspace: "/should-not-touch-workspace",
    runId: "801",
    runAttempt: "1",
    exists: hostTouched,
    isExecutable: hostTouched,
  };

  assert.throws(
    () =>
      prepareSaariSparkExactTupleRun({
        identity: admitted({ reviewScope: "P0-only" }),
        engine: trustedEngine(),
        host,
        config: CONFIG,
      }),
    /comprehensive/,
  );
  assert.throws(
    () =>
      prepareSaariSparkExactTupleRun({
        identity: admitted({ reviewerActor: "pr-author" }),
        engine: trustedEngine(),
        host,
        config: CONFIG,
      }),
    /enrolled producer identity/,
  );
  assert.throws(
    () =>
      prepareSaariSparkExactTupleRun({
        identity: admitted({ expectedHeadSha: "3".repeat(40), reviewScope: "comprehensive" }),
        engine: trustedEngine({ engineSha: CALLER_SHA }),
        host,
        config: CONFIG,
      }),
    /defining-workflow commit/,
  );

  const workflow = readText(".github/workflows/saari-exact-tuple-review.yml");
  const rejectScript = extractStepRunScript(
    workflow,
    "Reject stale exact-tuple identity before host work",
  );
  assert.doesNotMatch(rejectScript, /CODEX_HOME|clawsweeper-command\.lock|auth\.json/);
  const rejected = runPinnedEngineScript(rejectScript, {
    TARGET_REPOSITORY: "example-private-suite",
    TARGET_REPOSITORY_ID: "1000000001",
    TARGET_REPO: "example-org/example-private-suite",
    REVIEW_SCOPE: "P0-only",
    PR_NUMBER: "7",
    REVIEW_EPOCH: "3",
    REPOSITORY_ID: "1000000001",
    BASE_SHA: BASE,
    HEAD_SHA: HEAD,
    MERGE_BASE_SHA: "3".repeat(40),
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.stderr, /comprehensive/);

  const fake = fakeSparkHome();
  const admittedIdentity = runPinnedEngineScript(rejectScript, {
    TARGET_REPOSITORY: "example-private-suite",
    TARGET_REPOSITORY_ID: "1000000001",
    TARGET_REPO: "example-org/example-private-suite",
    REVIEW_SCOPE: "comprehensive",
    PR_NUMBER: "7",
    REVIEW_EPOCH: "3",
    REPOSITORY_ID: "1000000001",
    BASE_SHA: BASE,
    HEAD_SHA: HEAD,
    MERGE_BASE_SHA: "3".repeat(40),
    CLAWSWEEPER_EXACT_TUPLE_CONFIG: OVERLAY_PATH,
    TRUSTED_ENGINE_REPOSITORY: ENGINE_REPO,
    GITHUB_RUN_ID: "801",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ENV: fake.envFile,
  });
  assert.equal(admittedIdentity.ok, true, admittedIdentity.stderr);
  const bound = readText(fake.envFile);
  assert.match(bound, /REVIEWER_ACTOR=example-reviewer-bot/);
  assert.match(bound, /EXACT_TUPLE_ARTIFACT_NAME=example-suite-review-801-1/);
});

test("Spark host preflight reuses the existing profile and fails closed when tools are absent", () => {
  const workflow = readText(".github/workflows/saari-exact-tuple-review.yml");
  const preflight = extractStepRunScript(
    workflow,
    "Reuse the existing Spark subscription profile in place",
  );
  const fake = fakeSparkHome();
  const ok = runPinnedEngineScript(preflight, {
    HOME: fake.home,
    PATH: `${join(fake.home, ".local", "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    GITHUB_ENV: fake.envFile,
  });
  assert.equal(ok.ok, true);
  const envText = readText(fake.envFile);
  assert.ok(envText.includes(`CODEX_HOME=${saariSparkCodexHomePath(fake.home)}`));
  assert.match(envText, /CLAWSWEEPER_COMMAND_LOCK=/);
  assert.match(envText, /CODEX_BIN=/);
  assert.doesNotMatch(envText, /OPENAI_API_KEY|CLAWSWEEPER_MODEL|sk-/);

  const missingProfile = fakeSparkHome();
  writeFileSync(join(missingProfile.home, ".config", "clawsweeper", "codex-home", "auth.json"), "");
  const noAuth = runPinnedEngineScript(preflight, {
    HOME: join(missingProfile.home, "missing"),
    PATH: `${join(missingProfile.home, ".local", "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    GITHUB_ENV: missingProfile.envFile,
  });
  assert.equal(noAuth.ok, false);
  assert.match(noAuth.stderr, /subscription profile is absent/);

  const noCodex = fakeSparkHome();
  writeFileSync(join(noCodex.home, ".local", "bin", "codex"), "#!/bin/sh\nexit 0\n", {
    mode: 0o644,
  });
  chmodSync(join(noCodex.home, ".local", "bin", "codex"), 0o644);
  const missingExec = runPinnedEngineScript(preflight, {
    HOME: noCodex.home,
    PATH: "/no-such-spark-bin:/usr/bin:/bin",
    CODEX_BIN: join(noCodex.home, "not-codex"),
    GITHUB_ENV: noCodex.envFile,
  });
  assert.equal(missingExec.ok, false);
  assert.match(missingExec.stderr, /not an executable|absent from known paths/);
});
