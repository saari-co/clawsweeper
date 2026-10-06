/** Controlled producer -> supplied Conductor artifact proof; no network or live mutation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { processGateReport } from "../test/process-gate-report-helper.ts";
import { closeDecision, reviewFinding } from "../test/helpers.ts";
import {
  createExactReviewBundle,
  zipExactReviewBundle,
} from "../dist/repair/exact-review-bundle.js";

const checkout = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "supply a current Conductor checkout");
const consumerHead = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const files = ["review_conductor_userland.py", "review_result_projection.py"].map((name) => ({
  name,
  sha256: createHash("sha256")
    .update(readFileSync(join(checkout, "tools", name)))
    .digest("hex"),
}));
const baseDecision = closeDecision();
const gates = ["own_current_check", "owner_merge_authority"];
const work = mkdtempSync(join(tmpdir(), "process-gate-consumer-"));
try {
  const python = join(work, "consume.py");
  writeFileSync(
    python,
    `import json,sys\nfrom pathlib import Path\nsys.path.insert(0, ${JSON.stringify(join(checkout, "tools"))})\nimport review_conductor_userland as u\naction={"repository":"example-org/example-private-suite","pr_number":123,"base_sha":"${"a".repeat(40)}","head_sha":"${"c".repeat(40)}","review_epoch":3}\naction.update(json.loads(sys.argv[2]))\np=u.parse_clawsweeper_bundle(Path(sys.argv[1]).read_bytes(),workflow_run_id=801,action=action,policy={"reviewers":{"clawsweeper":"example-reviewer"}})\nprint(json.dumps({k:p[k] for k in ["verdict","content_verdict","process_gates","merge_authorized"]}))\n`,
  );
  function consume(report: string, index: number, overrides = {}) {
    const reportPath = join(work, `${index}.md`);
    writeFileSync(reportPath, report);
    const bundleDir = join(work, `bundle-${index}`);
    createExactReviewBundle({
      bundleDir,
      reviewPath: reportPath,
      createdAt: "2026-09-15T00:00:00.000Z",
      context: {
        repository: "example-org/example-private-suite",
        sourceSha: "b".repeat(40),
        runId: "801",
        runAttempt: 1,
        producerJob: "review",
        decisionSha256: "d".repeat(64),
        targetRepo: "example-org/example-private-suite",
        targetBranch: "main",
        itemNumber: 123,
        itemKind: "pull_request",
        itemKey: "example-org/example-private-suite#123",
        protocolVersion: 1,
        leaseRevision: null,
        claimGeneration: null,
        liveProceeded: true,
        liveTerminalNoop: false,
        liveTerminalMissing: false,
        liveGuardedOpen: false,
      },
    });
    const zipPath = join(work, `${index}.zip`);
    writeFileSync(zipPath, zipExactReviewBundle(bundleDir));
    return JSON.parse(
      execFileSync("python3", [python, zipPath, JSON.stringify(overrides)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  }
  const cases: [string, Record<string, unknown>, string][] = [
    ["qualified process wait", { processGates: gates }, "clean"],
    ["findings preserved", { processGates: gates, reviewFindings: [reviewFinding()] }, "findings"],
    [
      "proof deficiency preserved",
      {
        processGates: gates,
        realBehaviorProof: {
          ...baseDecision.realBehaviorProof,
          status: "insufficient",
          needsContributorAction: true,
        },
      },
      "proof_deficient",
    ],
    [
      "maintainer decision preserved",
      {
        processGates: gates,
        maintainerDecision: {
          ...baseDecision.maintainerDecision,
          required: true,
          kind: "product_direction",
          question: "Choose policy",
          rationale: "Owner policy",
          options: [{ title: "Choose", body: "Decide scope", recommended: true }],
          likelyOwner: { person: "@alice", reason: "Owner", confidence: "high" },
        },
      },
      "human_policy",
    ],
  ];
  const results = [];
  // Cases use actual Decision parser -> report renderer -> bundle producer -> consumer parser.
  for (const [index, [name, overrides, expected]] of cases.entries()) {
    const result = consume(processGateReport(overrides), index);
    assert.equal(result.content_verdict, expected, name);
    assert.equal(result.merge_authorized, false);
    results.push({ name, result });
  }
  const rendered = processGateReport({ processGates: gates });
  for (const [index, override] of [{ head_sha: "f".repeat(40) }, { review_epoch: 4 }].entries()) {
    assert.throws(() => consume(rendered, index + 10, override));
    results.push({ name: "stale tuple rejected", override });
  }
  // Runtime failures are preserved in original report fields, never overwritten by gates.
  const failed = consume(
    rendered.replace("review_terminal_failure: false", "review_terminal_failure: true"),
    20,
  );
  assert.equal(failed.content_verdict, "failed");
  results.push({ name: "terminal failure preserved", result: failed });
  for (const [index, processGates] of [undefined, [], ["owner_merge_authority"]].entries()) {
    const report = processGateReport(processGates === undefined ? {} : { processGates }).replace(
      /^pr_rating_overall: .*$/m,
      "pr_rating_overall: F",
    );
    const result = consume(report, 30 + index);
    assert.equal(result.content_verdict, "human_policy");
    assert.equal(result.merge_authorized, false);
    results.push({ name: "missing own-check cannot waive F", result });
  }
  console.log(JSON.stringify({ consumerHead, files, results }, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
