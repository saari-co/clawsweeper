import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDecision } from "../dist/clawsweeper.js";
import {
  fetchProcessGateChecks,
  parseProcessGates,
  qualifyOwnCurrentCheck,
  validateDecisionProcessGates,
} from "../dist/review-process-gates.js";
import { reportProcessGates } from "../dist/clawsweeper-report-parser.js";
import { parseExactTupleConfig } from "../dist/saari-exact-tuple.js";
import { closeDecision } from "./helpers.ts";

const identity = {
  repository: "example-org/example-private-suite",
  repositoryId: 1234,
  itemNumber: 7,
  baseSha: "1".repeat(40),
  headSha: "2".repeat(40),
  reviewEpoch: 3,
  reviewScope: "comprehensive" as const,
  reviewerActor: "example-reviewer",
  artifactPrefix: "example-review",
};
const tenant = {
  repository: identity.repository,
  repositoryId: identity.repositoryId,
  visibility: "private" as const,
  defaultBranch: "main",
  reviewerActor: identity.reviewerActor,
  reviewScope: identity.reviewScope,
  artifactPrefix: identity.artifactPrefix,
  publishSideEffects: false as const,
  processGateCheck: { appId: 123, name: "Native Review" },
};
const pull = {
  number: 7,
  state: "open",
  base: { sha: identity.baseSha, repo: { full_name: identity.repository, id: 1234 } },
  head: { sha: identity.headSha },
};
const check = {
  id: 99,
  name: "Native Review",
  app: { id: 123 },
  status: "queued",
  conclusion: null,
  head_sha: identity.headSha,
  external_id:
    "review-conductor:" +
    createHash("sha256")
      .update(`${identity.repository}|7|${identity.baseSha}|${identity.headSha}|3|Native Review`)
      .digest("hex"),
};
function qualify(checkValue: unknown = check, pullValue: unknown = pull) {
  return qualifyOwnCurrentCheck(identity, tenant, pullValue, {
    total_count: 1,
    check_runs: [checkValue],
  });
}

test("process gates are explicit, bounded, unique; omission/empty remains unknown", () => {
  assert.equal(parseProcessGates(undefined), undefined);
  assert.deepEqual(parseProcessGates([]), []);
  assert.deepEqual(parseProcessGates(["own_current_check", "owner_merge_authority"]), [
    "own_current_check",
    "owner_merge_authority",
  ]);
  for (const value of [
    null,
    "own_current_check",
    {},
    [1],
    [null],
    ["other"],
    ["own_current_check", "own_current_check"],
  ]) {
    assert.throws(() => parseProcessGates(value), /processGates/);
    assert.throws(() => parseDecision(closeDecision({ processGates: value })), /processGates/);
  }
  assert.equal(parseDecision(closeDecision()).processGates, undefined);
});

test("own check requires trusted exact tuple, enrolled issuer, and in-flight unique check", () => {
  assert.equal(qualify(), true);
  assert.equal(qualify({ ...check, status: "in_progress" }), true);
  for (const wrong of [
    { ...check, app: { id: 999 } },
    { ...check, name: "CI" },
    { ...check, external_id: "copied prose claim" },
    { ...check, head_sha: "f".repeat(40) },
    { ...check, status: "completed" },
    { ...check, conclusion: "success" },
  ])
    assert.equal(qualify(wrong), false);
  for (const wrongPull of [
    { ...pull, number: 8 },
    { ...pull, state: "closed" },
    { ...pull, head: { sha: "f".repeat(40) } },
    { ...pull, base: { ...pull.base, sha: "f".repeat(40) } },
    { ...pull, base: { ...pull.base, repo: { full_name: "other/repo", id: 1234 } } },
    { ...pull, base: { ...pull.base, repo: { full_name: identity.repository, id: 5678 } } },
  ])
    assert.equal(qualify(check, wrongPull), false);
  const checks = { total_count: 1, check_runs: [check] };
  assert.equal(
    qualifyOwnCurrentCheck({ ...identity, reviewEpoch: 4 }, tenant, pull, checks),
    false,
  );
  const { processGateCheck: _, ...legacyTenant } = tenant;
  assert.equal(qualifyOwnCurrentCheck(identity, legacyTenant, pull, checks), false);
  assert.equal(
    qualifyOwnCurrentCheck(identity, tenant, pull, { total_count: 2, check_runs: [check] }),
    false,
  );
  assert.equal(
    qualifyOwnCurrentCheck(identity, tenant, pull, { total_count: 2, check_runs: [check, check] }),
    false,
  );
});

test("runtime rejects unsupported claims without altering proof/findings/grades", () => {
  const decision = parseDecision(
    closeDecision({
      decision: "keep_open",
      closeReason: "none",
      processGates: ["own_current_check"],
    }),
  );
  assert.throws(() => validateDecisionProcessGates(decision, false), /runner-qualified/);
  assert.equal(validateDecisionProcessGates(decision, true), decision);
  assert.throws(() => validateDecisionProcessGates(decision, true, false), /failed terminal/);
  const failed = {
    ...decision,
    codexTerminalFailure: true,
    localCheckoutAccess: "unverified" as const,
  };
  assert.equal(validateDecisionProcessGates(failed, true), failed);
  assert.throws(
    () => validateDecisionProcessGates({ ...decision, decision: "close" }, true),
    /keep_open/,
  );
});

test("report process evidence roundtrips and rejects duplicates/malformed input", () => {
  assert.equal(reportProcessGates("---\ndecision: keep_open\n---\n"), undefined);
  for (const gates of [[], ["own_current_check"], ["own_current_check", "owner_merge_authority"]]) {
    assert.deepEqual(
      reportProcessGates(`---\nprocess_gates: ${JSON.stringify(gates)}\n---\n`),
      gates,
    );
  }
  assert.throws(
    () => reportProcessGates("---\nprocess_gates: []\nprocess_gates: []\n---\n"),
    /duplicate/,
  );
  assert.throws(() => reportProcessGates('---\nprocess_gates: ["other"]\n---\n'), /processGates/);
  assert.throws(() => reportProcessGates("---\nprocess_gates: definitely clean\n---\n"));
});

test("optional enrollment is strict and preserves legacy overlay", () => {
  const source = JSON.parse(
    readFileSync(new URL("./fixtures/saari-exact-tuple-overlay.json", import.meta.url), "utf8"),
  );
  assert.equal(
    parseExactTupleConfig(JSON.stringify(source)).tenants[0]?.processGateCheck,
    undefined,
  );
  source.tenants[0].process_gate_check = { app_id: 123, name: "Native Review" };
  assert.deepEqual(
    parseExactTupleConfig(JSON.stringify(source)).tenants[0]?.processGateCheck,
    tenant.processGateCheck,
  );
  for (const invalid of [
    null,
    {},
    { app_id: "123", name: "Native Review" },
    { app_id: 0, name: "Native Review" },
    { app_id: 123, name: "" },
    { app_id: 123, name: " Native Review" },
    { app_id: 123, name: "Native Review", extra: true },
  ]) {
    source.tenants[0].process_gate_check = invalid;
    assert.throws(() => parseExactTupleConfig(JSON.stringify(source)), /process_gate_check/);
  }
});

import { processGateReport } from "./process-gate-report-helper.ts";

test("real decision parser and report renderer preserve qualified process evidence", () => {
  const gates = ["own_current_check", "owner_merge_authority"];
  const report = processGateReport({ processGates: gates });
  assert.deepEqual(reportProcessGates(report), gates);
  assert.match(report, /^review_epoch: 3$/m);
  assert.match(report, /^local_checkout_access: verified$/m);
  assert.equal(reportProcessGates(processGateReport()), undefined);
});

test("complete check lookup includes older attempts beyond the first 100", () => {
  const unrelated = Array.from({ length: 100 }, (_, n) => ({ ...check, id: n + 1000, name: "CI" }));
  for (const duplicate of [false, true]) {
    const all = [...unrelated, check, ...(duplicate ? [{ ...check, id: 2000 }] : [])];
    const paths: string[] = [];
    const fetched = fetchProcessGateChecks(
      (args) => {
        paths.push(args[1]!);
        const page = Number(new URL(`https://api.github.com/${args[1]}`).searchParams.get("page"));
        return { total_count: all.length, check_runs: all.slice((page - 1) * 100, page * 100) };
      },
      identity.repository,
      identity.headSha,
    );
    assert.equal(paths.length, 2);
    for (const path of paths) assert.match(path, /filter=all&per_page=100&page=[12]$/);
    assert.equal(qualifyOwnCurrentCheck(identity, tenant, pull, fetched), !duplicate);
  }
});

test("check pagination rejects truncated, drifting, malformed and repeated pages", () => {
  const first = Array.from({ length: 100 }, (_, n) => ({ ...check, id: n + 1000 }));
  for (const second of [
    { total_count: 101, check_runs: [] },
    { total_count: 102, check_runs: [{ ...check, id: 2000 }] },
    { total_count: 101, check_runs: [first[0]] },
    { total_count: 101, check_runs: [{ ...check, id: "2000" }] },
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        fetchProcessGateChecks(
          () => (++calls === 1 ? { total_count: 101, check_runs: first } : second),
          identity.repository,
          identity.headSha,
        ),
      /pagination/,
    );
  }
  assert.throws(
    () =>
      fetchProcessGateChecks(
        () => ({ total_count: 2, check_runs: [check] }),
        identity.repository,
        identity.headSha,
      ),
    /pagination/,
  );
});

test("generation requires explicit supported gates; parser enforces semantic uniqueness", () => {
  const schema = JSON.parse(
    readFileSync(new URL("../schema/clawsweeper-decision.schema.json", import.meta.url), "utf8"),
  );
  assert.ok(schema.required.includes("processGates"), "generation requires an explicit gate array");
  assert.equal(schema.properties.processGates.type, "array");
  assert.equal(schema.properties.processGates.maxItems, 2);
  assert.equal(
    schema.properties.processGates.enum,
    undefined,
    "array-valued enums are not accepted by Codex",
  );
  assert.equal(schema.properties.processGates.uniqueItems, undefined);
  assert.deepEqual(schema.properties.processGates.items.enum, [
    "own_current_check",
    "owner_merge_authority",
  ]);
  const allowed = [
    [],
    ["own_current_check"],
    ["owner_merge_authority"],
    ["own_current_check", "owner_merge_authority"],
    ["owner_merge_authority", "own_current_check"],
  ];
  for (const gates of allowed) {
    assert.deepEqual(parseProcessGates(gates), gates);
    assert.deepEqual(parseDecision(closeDecision({ processGates: gates })).processGates, gates);
  }
  for (const gate of schema.properties.processGates.items.enum) {
    assert.throws(() => parseProcessGates([gate, gate]), /unique/);
    assert.throws(() => parseDecision(closeDecision({ processGates: [gate, gate] })), /unique/);
  }
  assert.equal(
    parseDecision(closeDecision()).processGates,
    undefined,
    "legacy omission remains unknown",
  );
});
