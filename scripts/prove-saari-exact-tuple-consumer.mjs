#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SUITE = "example-org/example-private-suite";
const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const ENGINE = "a".repeat(40);
const PIN_RELATIVE = "config/saari-exact-tuple-consumer-pin.json";
const OVERLAY_RELATIVE = "test/fixtures/saari-exact-tuple-overlay.json";

export function repoRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function loadConsumerPin(root = repoRoot()) {
  const parsed = JSON.parse(readFileSync(join(root, PIN_RELATIVE), "utf8"));
  if (parsed.schema !== "saari.clawsweeper.exact-tuple-consumer-pin.v1") {
    throw new Error("consumer pin schema is invalid");
  }
  if (parsed.source_repository !== "saari-co/review-conductor") {
    throw new Error("consumer pin repository is not the pinned Review Conductor");
  }
  if (!/^[0-9a-f]{40}$/.test(String(parsed.source_commit ?? ""))) {
    throw new Error("consumer pin commit is invalid");
  }
  if (parsed.entry !== "tools/review_conductor_userland.py") {
    throw new Error("consumer pin entry is not parse_clawsweeper_bundle");
  }
  if (parsed.function !== "parse_clawsweeper_bundle") {
    throw new Error("consumer pin function is not parse_clawsweeper_bundle");
  }
  if (!parsed.files || typeof parsed.files !== "object") {
    throw new Error("consumer pin files are required");
  }
  return parsed;
}

export function parseProveArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--consumer-checkout") {
      values.consumerCheckout = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith("--consumer-checkout=")) {
      values.consumerCheckout = token.slice("--consumer-checkout=".length);
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return values;
}

export function resolveConsumerCheckout(args, root = repoRoot()) {
  const supplied = String(args.consumerCheckout ?? "").trim();
  if (!supplied) {
    throw new Error(
      "consumer checkout is required; pinned parse_clawsweeper_bundle proof cannot be skipped",
    );
  }
  if (!existsSync(supplied) || !lstatSync(supplied).isDirectory()) {
    throw new Error("consumer checkout must be an existing directory");
  }
  const checkout = realpathSync(supplied);
  const producer = realpathSync(root);
  const rel = relative(producer, checkout);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`))) {
    throw new Error(
      "consumer checkout must be an independent supplied tree, not this producer repository",
    );
  }
  return checkout;
}

export function verifyPinnedConsumerFiles(checkout, pin = loadConsumerPin()) {
  const verified = [];
  for (const [rel, expected] of Object.entries(pin.files)) {
    const filePath = join(checkout, rel);
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
      throw new Error(`pinned consumer file is missing: ${rel}`);
    }
    const bytes = readFileSync(filePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== expected.sha256) {
      throw new Error(`pinned consumer file hash mismatch: ${rel}`);
    }
    if (bytes.length !== expected.bytes) {
      throw new Error(`pinned consumer file size mismatch: ${rel}`);
    }
    verified.push({ path: rel, sha256, bytes: bytes.length });
  }
  if (existsSync(join(checkout, ".git"))) {
    const head = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    if (head !== pin.source_commit) {
      throw new Error("consumer checkout HEAD is not the pinned Conductor commit");
    }
  }
  return verified;
}

function identity() {
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
  };
}

async function producerModules() {
  const root = repoRoot();
  const bundleUrl = pathToFileURL(join(root, "dist/repair/exact-review-bundle.js")).href;
  const tupleUrl = pathToFileURL(join(root, "dist/saari-exact-tuple.js")).href;
  const [{ createExactReviewBundle, exactReviewDecisionSha256, zipExactReviewBundle }, tuple] =
    await Promise.all([import(bundleUrl), import(tupleUrl)]);
  return { createExactReviewBundle, exactReviewDecisionSha256, zipExactReviewBundle, tuple };
}

function overlayConfig(tuple, root = repoRoot()) {
  return tuple.parseExactTupleConfig(readFileSync(join(root, OVERLAY_RELATIVE), "utf8"));
}

function nativeReport(tuple, config, overrides = {}) {
  const bound = tuple.bindSaariExactTupleIdentity(identity(), config);
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
    tuple.renderExactTupleIdentitySection(bound),
    "",
    "## Review Findings",
    "",
    "No contributor-facing findings.",
    "",
  ].join("\n");
}

function producerBundle(modules, config, report) {
  const root = mkdtempSync(join(tmpdir(), "saari-producer-bundle-"));
  const reportPath = join(root, "7.md");
  writeFileSync(reportPath, report);
  const bundleDir = join(root, "bundle");
  modules.createExactReviewBundle({
    bundleDir,
    reviewPath: reportPath,
    createdAt: "2026-09-13T12:00:00.000Z",
    context: {
      repository: SUITE,
      sourceSha: ENGINE,
      runId: "801",
      runAttempt: 1,
      producerJob: "review",
      decisionSha256: modules.exactReviewDecisionSha256(
        JSON.stringify({
          base_sha: BASE,
          engine_sha: ENGINE,
          head_sha: HEAD,
          item_number: 7,
          review_epoch: 3,
          review_scope: "comprehensive",
          reviewer_actor: "example-reviewer-bot",
          target_repo: SUITE,
        }),
      ),
      targetRepo: SUITE,
      targetBranch: "main",
      itemNumber: 7,
      itemKind: "pull_request",
      itemKey: `${SUITE}#7`,
      protocolVersion: 1,
      leaseRevision: null,
      claimGeneration: null,
      liveProceeded: true,
      liveTerminalNoop: false,
      liveTerminalMissing: false,
      liveGuardedOpen: false,
    },
  });
  return modules.zipExactReviewBundle(bundleDir);
}

function parseWithSuppliedConsumer(checkout, zip, extras = {}) {
  const work = mkdtempSync(join(tmpdir(), "saari-consumer-"));
  const zipPath = join(work, "bundle.zip");
  const scriptPath = join(work, "parse.py");
  writeFileSync(zipPath, zip);
  writeFileSync(
    scriptPath,
    `
import json, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(join(checkout, "tools"))})
import review_conductor_userland as userland
raw = Path(sys.argv[1]).read_bytes()
action = {
    "repository": "example-org/example-private-suite",
    "pr_number": 7,
    "base_sha": ${JSON.stringify(BASE)},
    "head_sha": ${JSON.stringify(HEAD)},
    "review_epoch": 3,
}
action.update(json.loads(sys.argv[2]))
policy = {"reviewers": {"clawsweeper": "example-reviewer-bot"}}
parsed = userland.parse_clawsweeper_bundle(raw, workflow_run_id=801, action=action, policy=policy)
print(json.dumps({"verdict": parsed["verdict"], "ready_qualified": parsed["ready_qualified"]}))
`,
  );
  return JSON.parse(
    execFileSync("python3", [scriptPath, zipPath, JSON.stringify(extras)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function expectReject(run) {
  try {
    const parsed = run();
    throw new Error(`consumer accepted a reject case: ${JSON.stringify(parsed)}`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes("consumer accepted a reject case")) throw error;
    return { rejected: true };
  }
}

export async function proveSuppliedConsumer(checkout, pin = loadConsumerPin()) {
  const files = verifyPinnedConsumerFiles(checkout, pin);
  const modules = await producerModules();
  const config = overlayConfig(modules.tuple);
  const admitted = parseWithSuppliedConsumer(
    checkout,
    producerBundle(modules, config, nativeReport(modules.tuple, config)),
  );
  if (admitted.verdict !== "clean" || admitted.ready_qualified !== true) {
    throw new Error("pinned consumer did not accept the admitted comprehensive bundle");
  }

  const zip = producerBundle(modules, config, nativeReport(modules.tuple, config));
  const rejects = [
    ["repository mismatch", { repository: "example-org/unrelated-repo" }],
    ["pull request mismatch", { pr_number: 8 }],
    ["head SHA mismatch", { head_sha: "3".repeat(40) }],
    ["base SHA mismatch", { base_sha: "4".repeat(40) }],
    ["review epoch mismatch", { review_epoch: 8 }],
  ].map(([name, extra]) => ({
    name,
    expected: "reject",
    ...expectReject(() => parseWithSuppliedConsumer(checkout, zip, extra)),
  }));

  rejects.push({
    name: "P0-only scope",
    expected: "reject",
    ...expectReject(() =>
      parseWithSuppliedConsumer(
        checkout,
        producerBundle(
          modules,
          config,
          nativeReport(modules.tuple, config, { review_scope: "P0-only" }),
        ),
      ),
    ),
  });
  rejects.push({
    name: "caller-stamped actor",
    expected: "reject",
    ...expectReject(() =>
      parseWithSuppliedConsumer(
        checkout,
        producerBundle(
          modules,
          config,
          nativeReport(modules.tuple, config, { reviewer_actor: "clawsweeper" }),
        ),
      ),
    ),
  });
  rejects.push({
    name: "incomplete review",
    expected: "reject",
    ...expectReject(() =>
      parseWithSuppliedConsumer(
        checkout,
        producerBundle(
          modules,
          config,
          nativeReport(modules.tuple, config, { review_status: "failed" }),
        ),
      ),
    ),
  });

  return {
    consumer: {
      repository: pin.source_repository,
      commit: pin.source_commit,
      entry: pin.entry,
      function: pin.function,
      files,
    },
    cases: [
      {
        name: "admitted comprehensive bundle",
        expected: "accept",
        verdict: admitted.verdict,
        ready_qualified: admitted.ready_qualified,
      },
      ...rejects,
    ],
    parser: "supplied parse_clawsweeper_bundle",
    vendored: false,
  };
}

export async function runProveSaariExactTupleConsumer(argv, root = repoRoot()) {
  const pin = loadConsumerPin(root);
  const checkout = resolveConsumerCheckout(parseProveArgs(argv), root);
  return proveSuppliedConsumer(checkout, pin);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runProveSaariExactTupleConsumer(process.argv.slice(2))
    .then((proof) => {
      process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
