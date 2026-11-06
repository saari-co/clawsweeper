#!/usr/bin/env node

// Exercise the real scanner without retaining its raw findings or source bytes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AgentInputScanError,
  agentInputScanFailureExitCode,
  scanAgentInput,
} from "../dist/agent-input-scan.js";

const output = resolve(process.argv[2] ?? "artifacts/scan-witness-reasons.json");
const root = mkdtempSync(join(tmpdir(), "clawsweeper-witness-proof-"));
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const results = [];

try {
  for (const scenario of ["unique", "repeated"]) {
    const cwd = join(root, scenario);
    mkdirSync(cwd);
    git(cwd, "init", "-q");
    git(cwd, "config", "user.name", "Scanner proof");
    git(cwd, "config", "user.email", "scanner-proof@example.invalid");
    const uri = "https://proof-user:proof-password@scanner-proof.invalid/example";
    const content = `first=${JSON.stringify(uri)}\n`;
    writeFileSync(join(cwd, "fixture.txt"), content + (scenario === "repeated" ? content : ""));
    git(cwd, "add", "fixture.txt");
    git(cwd, "commit", "-qm", "Synthetic scanner source");
    const base = git(cwd, "rev-parse", "HEAD");
    writeFileSync(
      join(cwd, "fixture.txt"),
      `header\n${content}${scenario === "repeated" ? content : ""}`,
    );
    git(cwd, "add", "fixture.txt");
    git(cwd, "commit", "-qm", "Move synthetic scanner source");
    const head = git(cwd, "rev-parse", "HEAD");
    try {
      scanAgentInput({
        cwd,
        prompt: "Controlled source witness diagnostics proof.",
        source: { kind: "committed", baseSha: base, headSha: head },
        timeoutMs: 60_000,
      });
      throw new Error("Expected synthetic unqualified source to remain refused.");
    } catch (error) {
      assert.ok(error instanceof AgentInputScanError, "Expected a structured scanner refusal.");
      assert.equal(agentInputScanFailureExitCode(error), 79);
      assert.equal(error.scanDiagnostic?.kind, "unclassified_finding");
      const inventory = error.scanDiagnostic.nativeFindings;
      assert.ok(inventory?.retained > 0, "Expected retained safe finding metadata.");
      const blobs = inventory.findings.filter((finding) => finding.material?.kind === "blob");
      assert.ok(blobs.length > 0, "Expected committed blob findings.");
      for (const finding of blobs) {
        const expected =
          finding.decoder === "PLAIN"
            ? scenario === "unique"
              ? "unique_plain_literal"
              : "ambiguous_literal"
            : "unsupported_decoder";
        assert.equal(finding.sourceLineReason, expected);
        assert.equal(
          finding.sourceLineStatus,
          expected === "unique_plain_literal" ? "proven" : "unavailable",
        );
      }
      results.push({ scenario, base, head, exit: 79, diagnostic: error.scanDiagnostic });
    }
  }
  writeFileSync(output, JSON.stringify({ passed: true, root, results }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, output, scenarios: results.length }));
} catch {
  // Assertions and native errors can carry input. Keep only a closed result.
  writeFileSync(
    output,
    JSON.stringify({ passed: false, root, completedScenarios: results.length }) + "\n",
  );
  console.error("Scanner witness proof failed; raw failure details withheld.");
  process.exitCode = 1;
}
