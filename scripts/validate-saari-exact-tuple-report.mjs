#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,199}$/;
const MAX_REPORT_BYTES = 512 * 1024;
const MAX_FRONTMATTER_BYTES = 128 * 1024;

export function validateSaariExactTupleReport(options) {
  const reportPath = String(options.reportPath ?? "").trim();
  const repository = String(options.repository ?? "")
    .trim()
    .toLowerCase();
  const itemNumber = Number(options.itemNumber);
  const baseSha = String(options.baseSha ?? "").trim();
  const headSha = String(options.headSha ?? "").trim();
  const reviewEpoch = String(options.reviewEpoch ?? "").trim();
  const reviewScope = String(options.reviewScope ?? "").trim();
  const reviewerActor = String(options.reviewerActor ?? "").trim();

  if (!reportPath) throw new Error("report path is required");
  if (!REPOSITORY_PATTERN.test(repository)) throw new Error("repository is invalid");
  if (!Number.isSafeInteger(itemNumber) || itemNumber <= 0) {
    throw new Error("item number must be a positive integer");
  }
  if (!SHA_PATTERN.test(baseSha)) throw new Error("base SHA is invalid");
  if (!SHA_PATTERN.test(headSha)) throw new Error("head SHA is invalid");
  if (!/^\d+$/.test(reviewEpoch)) throw new Error("review epoch is invalid");
  if (reviewScope !== "comprehensive") {
    throw new Error("review scope must be the admitted comprehensive native scope");
  }
  if (!ACTOR_PATTERN.test(reviewerActor)) throw new Error("reviewer actor is invalid");
  if (basename(reportPath) !== `${itemNumber}.md`) {
    throw new Error("report filename does not match the admitted item");
  }

  const stat = lstatSync(reportPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("report must be a regular non-symlink file");
  }
  if (stat.size <= 0 || stat.size > MAX_REPORT_BYTES) {
    throw new Error("report size is outside the exact-tuple bound");
  }

  const bytes = readFileSync(reportPath);
  const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const character of markdown) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      throw new Error("report contains disallowed control characters");
    }
  }
  if (!markdown.startsWith("---\n")) throw new Error("report frontmatter is missing");
  const frontmatterEnd = markdown.indexOf("\n---\n", 4);
  if (frontmatterEnd < 0 || frontmatterEnd > MAX_FRONTMATTER_BYTES) {
    throw new Error("report frontmatter is missing or too large");
  }

  const fields = new Map();
  for (const line of markdown.slice(4, frontmatterEnd).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (fields.has(key)) throw new Error(`report has duplicate frontmatter field: ${key}`);
    fields.set(key, value);
  }

  const expected = {
    repository,
    number: String(itemNumber),
    type: "pull_request",
    review_status: "complete",
    local_checkout_access: "verified",
    main_sha: baseSha,
    pull_head_sha: headSha,
    review_epoch: reviewEpoch,
    review_scope: "comprehensive",
    reviewer_actor: reviewerActor,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (String(fields.get(key) ?? "").toLowerCase() !== value.toLowerCase()) {
      throw new Error(`report ${key} does not match the admitted review`);
    }
  }
  if (String(fields.get("review_scope") ?? "") === "P0-only") {
    throw new Error("P0-only scope cannot clear the exact-tuple consumer");
  }

  const identitySection = "## Bound Review Identity";
  const identityStart = markdown.indexOf(identitySection, frontmatterEnd);
  if (identityStart < 0) {
    throw new Error("report is missing the engine-authored bound identity section");
  }
  const identityBody = markdown.slice(identityStart, identityStart + 800);
  for (const [key, value] of Object.entries({
    repository,
    number: String(itemNumber),
    main_sha: baseSha,
    pull_head_sha: headSha,
    review_epoch: reviewEpoch,
    review_scope: "comprehensive",
    reviewer_actor: reviewerActor,
  })) {
    if (!identityBody.includes(`- ${key}: ${value}`)) {
      throw new Error(`bound identity section omitted ${key}`);
    }
  }
  if (/review_scope:\s*P0-only/.test(identityBody)) {
    throw new Error("bound identity section must not record a P0-only scope");
  }

  return {
    repository,
    item_number: itemNumber,
    base_sha: baseSha,
    head_sha: headSha,
    review_epoch: reviewEpoch,
    review_scope: "comprehensive",
    reviewer_actor: reviewerActor,
    bytes: stat.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(
        "usage: validate-saari-exact-tuple-report.mjs --report PATH --repository OWNER/REPO --item-number N --base-sha SHA --head-sha SHA --review-epoch N --review-scope comprehensive --reviewer-actor ACTOR",
      );
    }
    values[key.slice(2)] = value;
  }
  return values;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  const result = validateSaariExactTupleReport({
    reportPath: args.report,
    repository: args.repository,
    itemNumber: args["item-number"],
    baseSha: args["base-sha"],
    headSha: args["head-sha"],
    reviewEpoch: args["review-epoch"],
    reviewScope: args["review-scope"],
    reviewerActor: args["reviewer-actor"],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
