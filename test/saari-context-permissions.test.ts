import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(
    new URL("../.github/workflows/saari-exact-tuple-review.yml", import.meta.url),
    "utf8",
  ),
);

test("native context probes refuse missing API scopes and never require writes", () => {
  const permissions = workflow.jobs.review.permissions as Record<string, string>;
  assert.ok(Object.values(permissions).every((value) => value === "read"));
  assert.equal(workflow.permissions && Object.keys(workflow.permissions).length, 0);
  assert.deepEqual(workflow.jobs.admit.permissions, { contents: "read", "pull-requests": "read" });
  const step = workflow.jobs.review.steps.find(
    (candidate: { name: string }) => candidate.name === "Verify native review context access",
  );
  assert.ok(step);
  assert.ok(
    workflow.jobs.review.steps.indexOf(step) <
      workflow.jobs.review.steps.findIndex(
        (candidate: { name: string }) =>
          candidate.name === "Check out the trusted ClawSweeper engine",
      ),
  );
  const root = mkdtempSync(join(tmpdir(), "saari-context-permissions-"));
  try {
    // Controlled permission-denial fixture for the actual workflow shell. This
    // is not live GitHub or model proof; the live job repeats the same probes.
    const gh = join(root, "gh");
    writeFileSync(
      gh,
      `#!/bin/sh
set -eu
[ "$1" = api ] && [ "$3" = --jq ] && [ "$4" = empty ]
case "$2" in
  repos/example/private/issues/*) scope=issues ;;
  repos/example/private/pulls/*) scope=pull-requests ;;
  repos/example/private/commits/*/check-runs) scope=checks ;;
  repos/example/private/commits/*/status) scope=statuses ;;
  *) exit 99 ;;
esac
case ",$READ_SCOPES," in *,$scope,*) ;; *) echo "missing read scope: $scope" >&2; exit 1 ;; esac
echo "$scope" >> "$PROBE_RECORD"
echo "private response must be discarded"
`,
    );
    chmodSync(gh, 0o755);
    const run = (scopes: string[]) =>
      execFileSync("bash", ["-c", step.run], {
        env: {
          PATH: `${root}:${process.env.PATH}`,
          TARGET_REPO: "example/private",
          PR_NUMBER: "7",
          HEAD_SHA: "a".repeat(40),
          READ_SCOPES: scopes.join(","),
          PROBE_RECORD: join(root, "probes"),
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const scopes = Object.keys(permissions);
    for (const missing of ["issues", "pull-requests", "checks", "statuses"]) {
      assert.throws(() => run(scopes.filter((scope) => scope !== missing)), /missing read scope/);
    }
    writeFileSync(join(root, "probes"), "");
    assert.equal(run(scopes).trim(), "Native review context read access verified.");
    assert.deepEqual(
      new Set(readFileSync(join(root, "probes"), "utf8").trim().split("\n")),
      new Set(["issues", "pull-requests", "checks", "statuses"]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
