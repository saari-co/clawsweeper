#!/usr/bin/env node
/**
 * Build the Saari clawsweeper.telemetry.v1 envelope from host-side OpenClaw
 * queue records and ClawSweeper per-item artifacts. Writes --out only.
 * Does not push to git or call GitHub write APIs.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = "clawsweeper.telemetry.v1";
export const TENANT = "saari";
export const MAX_ROWS = 500;
const SHA_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_STALE_AFTER_SECONDS = 900;
const DEFAULT_EXECUTOR = "spark-2";
const DEFAULT_OPENCLAW_QUEUE_ROOT = join(homedir(), ".local/state/openclaw-review");
const DEFAULT_REVIEW_STATE_ROOT = join(homedir(), ".local/state/clawsweeper-review");
const SPARK_DGX_BLOB = "https://github.com/saari-co/spark-dgx/blob/main/";

export const CLAWSWEEPER_RANKS = [
  "S Challenger Crab",
  "A Diamond Lobster",
  "B Platinum Hermit",
  "C Gold Shrimp",
  "D Silver Shellfish",
  "F Unranked Krab",
  "N/A Off-meta Tidepool",
];

const RANK_BY_TIER = {
  S: "S Challenger Crab",
  A: "A Diamond Lobster",
  B: "B Platinum Hermit",
  C: "C Gold Shrimp",
  D: "D Silver Shellfish",
  F: "F Unranked Krab",
  NA: "N/A Off-meta Tidepool",
  "N/A": "N/A Off-meta Tidepool",
};

export const SAARI_LANE = {
  app_installation: "saari-clawsweeper (App ID 4070026)",
  queue_namespace: "spark-2:openclaw-review",
  state_store: "saari-co/clawsweeper-state@state",
  mutation_authority: "saari-co/spark-dgx clawsweeper-review lane",
};

const USAGE = `Usage:
  node scripts/telemetry/publish-saari-review-telemetry.mjs --out <path>
    [--openclaw-queue-root <dir>]
    [--review-state-root <dir>]
    [--engine-sha <sha>]
    [--executor <name>]
    [--ci-source none|gh]
    [--stale-after-seconds <n>]

Reads host-side OpenClaw done records and ClawSweeper items artifacts, writes
a clawsweeper.telemetry.v1 envelope, and does not push or mutate GitHub.
`;

export function parsePublisherArgs(argv) {
  const values = {
    openclawQueueRoot: DEFAULT_OPENCLAW_QUEUE_ROOT,
    reviewStateRoot: DEFAULT_REVIEW_STATE_ROOT,
    engineSha: null,
    executor: DEFAULT_EXECUTOR,
    ciSource: "none",
    staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
    out: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const take = () => {
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case "--help":
      case "-h":
        values.help = true;
        break;
      case "--openclaw-queue-root":
        values.openclawQueueRoot = take();
        break;
      case "--review-state-root":
        values.reviewStateRoot = take();
        break;
      case "--engine-sha":
        values.engineSha = take();
        break;
      case "--executor":
        values.executor = take();
        break;
      case "--ci-source":
        values.ciSource = take();
        break;
      case "--stale-after-seconds":
        values.staleAfterSeconds = Number(take());
        break;
      case "--out":
        values.out = take();
        break;
      default:
        throw new Error(`unknown option: ${arg}; use --help for usage`);
    }
  }
  if (values.help) return values;
  if (!values.out) throw new Error("--out is required");
  if (values.ciSource !== "none" && values.ciSource !== "gh") {
    throw new Error("--ci-source must be none or gh");
  }
  if (
    !Number.isInteger(values.staleAfterSeconds) ||
    values.staleAfterSeconds < 30 ||
    values.staleAfterSeconds > 86_400
  ) {
    throw new Error("--stale-after-seconds must be an integer from 30 to 86400");
  }
  if (values.engineSha && !SHA_RE.test(values.engineSha)) {
    throw new Error("--engine-sha must be a 40-character hex SHA");
  }
  if (!String(values.executor || "").trim()) throw new Error("--executor requires a value");
  return values;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function nonEmptyString(value, max = 2_000) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

export function sha(value) {
  const text = nonEmptyString(value, 40);
  return text && SHA_RE.test(text) ? text.toLowerCase() : null;
}

function booleanish(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1" || text === "yes") return true;
    if (text === "false" || text === "0" || text === "no") return false;
  }
  return null;
}

function integerish(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function isoDate(value, now) {
  const text = nonEmptyString(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  const timestamp = Date.parse(text);
  if (timestamp > now + 60_000) return null;
  return new Date(timestamp).toISOString();
}

function httpsLink(value) {
  const text = nonEmptyString(value, 2_000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parsePullIdentity(prUrl, repoValue) {
  const link = httpsLink(prUrl);
  if (link) {
    const url = new URL(link);
    if (url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 4 && parts[2] === "pull" && /^\d+$/.test(parts[3] || "")) {
        return {
          repository: `${parts[0]}/${parts[1]}`,
          prNumber: Number(parts[3]),
          prUrl: url.toString(),
        };
      }
    }
  }
  const repository = nonEmptyString(repoValue, 200);
  if (repository && REPO_RE.test(repository)) {
    return { repository, prNumber: null, prUrl: link };
  }
  return null;
}

export function mapClawsweeperRank(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (CLAWSWEEPER_RANKS.includes(text)) return text;
  const tier = text
    .replace(/^rating:\s*/i, "")
    .replace(/^overall tier:\s*/i, "")
    .trim();
  if (RANK_BY_TIER[tier]) return RANK_BY_TIER[tier];
  const compact = tier.replace(/[^A-Za-z]/g, "").toLowerCase();
  const aliases = {
    schallengercrab: "S Challenger Crab",
    challengercrab: "S Challenger Crab",
    adiamondlobster: "A Diamond Lobster",
    diamondlobster: "A Diamond Lobster",
    bplatinumhermit: "B Platinum Hermit",
    platinumhermit: "B Platinum Hermit",
    cgoldshrimp: "C Gold Shrimp",
    goldshrimp: "C Gold Shrimp",
    dsilvershellfish: "D Silver Shellfish",
    silvershellfish: "D Silver Shellfish",
    funrankedkrab: "F Unranked Krab",
    unrankedkrab: "F Unranked Krab",
    naoffmetatidepool: "N/A Off-meta Tidepool",
    offmetatidepool: "N/A Off-meta Tidepool",
  };
  return aliases[compact] ?? null;
}

function sparkDgxProofLink(proofPath) {
  const text = nonEmptyString(proofPath, 500);
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return httpsLink(text);
  if (text.startsWith("/") || text.includes("\\") || text.includes("..")) return null;
  return httpsLink(`${SPARK_DGX_BLOB}${text.replace(/^\/+/, "")}`);
}

function listJsonFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .map((name) => join(dir, name));
}

function readJsonFile(path) {
  try {
    return object(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    void error;
    return null;
  }
}

function overlayRunResult(record, queueRoot) {
  const id = nonEmptyString(record.id, 200);
  if (!id) return record;
  const result = readJsonFile(join(queueRoot, "runs", id, "result.json"));
  if (!result) return record;
  return {
    ...result,
    ...record,
    exit_code: record.exit_code ?? result.exit_code,
    review_result: record.review_result ?? result.review_result,
  };
}

function openclawFromRecord(record, directoryStatus) {
  const statusText = String(record.status ?? directoryStatus ?? "")
    .trim()
    .toLowerCase();
  if (["running", "in_progress", "in-progress", "claimed"].includes(statusText)) {
    return { openclaw: "running", openclaw_conclusion: null };
  }
  const exitCode = integerish(record.exit_code);
  const reviewClean = booleanish(record.review_clean);
  const findingCount = integerish(record.review_finding_count);
  const completed = ["completed", "done", "needs-human", "failed"].includes(statusText);
  if (!completed) return { openclaw: "unknown", openclaw_conclusion: null };
  // autoreview-run exit legend: 0=clean, 1=findings, 2=error,
  // 10/11=recovered clean/findings, 75/76=watchdog gave up. Only a clean
  // exit is terminal success; error/watchdog exits stay unknown.
  const cleanExit = exitCode === 0 || exitCode === 10;
  const findingsExit = exitCode === 1 || exitCode === 11;
  if (reviewClean === false || (findingCount !== null && findingCount > 0) || findingsExit) {
    return { openclaw: "completed", openclaw_conclusion: "failure" };
  }
  if (cleanExit && reviewClean !== false) {
    return { openclaw: "completed", openclaw_conclusion: "success" };
  }
  if (statusText === "failed" && exitCode !== null && exitCode !== 0) {
    return { openclaw: "completed", openclaw_conclusion: "failure" };
  }
  return { openclaw: "completed", openclaw_conclusion: null };
}

function readQueueRecords(queueRoot) {
  const buckets = [
    ["done", "completed"],
    ["running", "running"],
    ["needs-human", "needs-human"],
    ["failed", "failed"],
  ];
  const records = [];
  for (const [dirName, directoryStatus] of buckets) {
    for (const path of listJsonFiles(join(queueRoot, dirName))) {
      const raw = readJsonFile(path);
      if (!raw) continue;
      records.push({ record: overlayRunResult(raw, queueRoot), directoryStatus, path });
    }
  }
  return records;
}

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

function parseVerdict(markdown) {
  const marker = /clawsweeper-verdict:([a-z0-9_-]+)([^<\n]*)/i.exec(markdown);
  if (!marker) return null;
  const shaMatch =
    /\bsha=([0-9a-f]{40})\b/i.exec(marker[2] ?? "") ?? /\bsha=([0-9a-f]{40})\b/i.exec(markdown);
  return {
    verdict: marker[1].toLowerCase(),
    sha: sha(shaMatch?.[1]),
  };
}

function parseFindings(markdown) {
  const section = /## Review Findings\n([\s\S]*?)(?:\n## |\n<!-- |\s*$)/i.exec(markdown);
  if (!section) return { total: null, actionable: null };
  const items = [...section[1].matchAll(/^[-*]\s+(?!\s*none\b)(\S.*)$/gim)].map((match) =>
    match[1].trim(),
  );
  if (items.length === 0) return { total: 0, actionable: 0 };
  const actionable = items.filter((item) =>
    /^(p[0-2]|critical|high|actionable|blocker|must)\b/i.test(item),
  ).length;
  return { total: items.length, actionable: actionable > 0 ? actionable : null };
}

function clawsweeperFromArtifact(artifact) {
  if (!artifact) {
    return {
      clawsweeper: "unknown",
      clawsweeper_conclusion: null,
      rating: null,
      findings_total: null,
      findings_actionable: null,
    };
  }
  const verdict = artifact.verdict;
  let clawsweeper = "unknown";
  let conclusion = null;
  if (verdict === "pass" || verdict === "close") {
    clawsweeper = "completed";
    conclusion = "success";
  } else if (verdict === "needs-changes" || verdict === "needs-repair") {
    clawsweeper = "completed";
    conclusion = "failure";
  } else if (verdict === "needs-human" || verdict === "human-review") {
    clawsweeper = "completed";
    conclusion = "blocked";
  } else if (artifact.reviewStatus === "complete" || artifact.reviewStatus === "completed") {
    clawsweeper = "completed";
  }
  return {
    clawsweeper,
    clawsweeper_conclusion: conclusion,
    rating: artifact.rating,
    findings_total: artifact.findingsTotal,
    findings_actionable: artifact.findingsActionable,
  };
}

function walkItemFiles(root) {
  const files = [];
  const itemsRoot = join(root, "items");
  if (!existsSync(itemsRoot) || !statSync(itemsRoot).isDirectory()) return files;
  for (const entry of readdirSync(itemsRoot, { withFileTypes: true })) {
    const path = join(itemsRoot, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    if (!entry.isDirectory()) continue;
    for (const child of readdirSync(path, { withFileTypes: true })) {
      if (child.isFile() && child.name.endsWith(".md")) files.push(join(path, child.name));
    }
  }
  return files;
}

export function readClawsweeperArtifacts(reviewStateRoot) {
  const artifacts = [];
  for (const path of walkItemFiles(reviewStateRoot)) {
    let markdown;
    try {
      markdown = readFileSync(path, "utf8");
    } catch (error) {
      void error;
      continue;
    }
    const front = parseFrontMatter(markdown);
    const verdict = parseVerdict(markdown);
    const headSha = sha(front.pull_head_sha) ?? verdict?.sha ?? sha(front.head_sha);
    const identity = parsePullIdentity(front.url, front.repository);
    const prNumber = Number(front.number);
    if (!headSha || !identity?.repository || !Number.isInteger(prNumber) || prNumber < 1) continue;
    const findings = parseFindings(markdown);
    artifacts.push({
      repository: identity.repository,
      prNumber,
      headSha,
      baseSha: sha(front.main_sha) ?? sha(front.base_sha),
      verdict: verdict?.verdict ?? null,
      rating: mapClawsweeperRank(front.pr_rating_overall) ?? mapClawsweeperRank(front.pr_rating),
      findingsTotal: findings.total,
      findingsActionable: findings.actionable,
      observedAt: front.reviewed_at ?? null,
      proofPath: front.proof_path ?? null,
      prUrl: identity.prUrl,
      reviewStatus: String(front.review_status ?? "").toLowerCase(),
    });
  }
  return artifacts;
}

export function summarizeCheckRuns(payload) {
  const body = object(payload);
  const runs = Array.isArray(body?.check_runs) ? body.check_runs : [];
  if (runs.length === 0) return { ci: "unknown", ci_conclusion: null };
  const statuses = runs.map((run) =>
    String(object(run)?.status ?? "")
      .trim()
      .toLowerCase(),
  );
  const conclusions = runs.map((run) =>
    String(object(run)?.conclusion ?? "")
      .trim()
      .toLowerCase(),
  );
  if (statuses.some((status) => ["queued", "pending", "requested", "waiting"].includes(status))) {
    return { ci: "pending", ci_conclusion: null };
  }
  if (statuses.some((status) => ["running", "in_progress", "in-progress"].includes(status))) {
    return { ci: "running", ci_conclusion: null };
  }
  if (!statuses.every((status) => status === "completed")) {
    return { ci: "unknown", ci_conclusion: null };
  }
  if (
    conclusions.some((value) =>
      ["failure", "failed", "error", "cancelled", "canceled", "timed_out"].includes(value),
    )
  ) {
    return { ci: "completed", ci_conclusion: "failure" };
  }
  if (
    conclusions.some((value) =>
      ["success", "successful", "clean", "pass", "passed"].includes(value),
    )
  ) {
    return { ci: "completed", ci_conclusion: "success" };
  }
  if (
    conclusions.every((value) => ["skipped", "not_applicable", "n/a", "neutral"].includes(value))
  ) {
    return { ci: "completed", ci_conclusion: "skipped" };
  }
  return { ci: "unknown", ci_conclusion: null };
}

function defaultGhExec(repository, headSha) {
  const result = spawnSync("gh", ["api", `repos/${repository}/commits/${headSha}/check-runs`], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    void error;
    return null;
  }
}

function proofLinksFor(row) {
  const links = [];
  const prUrl = httpsLink(row.prUrl);
  if (prUrl) links.push(prUrl);
  for (const proofPath of row.proofPaths ?? []) {
    const proof = sparkDgxProofLink(proofPath);
    if (proof && !links.includes(proof)) links.push(proof);
  }
  return links;
}

function rowKey(repository, prNumber, headSha) {
  return `${repository}#${prNumber}:${headSha}`;
}

export function buildSaariReviewTelemetry(options) {
  const now = options.now ?? Date.now();
  const generatedAt = new Date(now).toISOString();
  const engineSha = sha(options.engineSha);
  const executor = nonEmptyString(options.executor, 200) ?? DEFAULT_EXECUTOR;
  const rowsByKey = new Map();

  const upsert = (partial) => {
    const repository = nonEmptyString(partial.repository, 200);
    const prNumber = Number(partial.pr_number);
    const headSha = sha(partial.head_sha);
    if (
      !repository ||
      !REPO_RE.test(repository) ||
      !Number.isInteger(prNumber) ||
      prNumber < 1 ||
      !headSha
    ) {
      return;
    }
    const key = rowKey(repository, prNumber, headSha);
    const existing = rowsByKey.get(key) ?? {
      repository,
      pr_number: prNumber,
      base_sha: null,
      head_sha: headSha,
      ci: "unknown",
      ci_conclusion: null,
      openclaw: "unknown",
      openclaw_conclusion: null,
      clawsweeper: "unknown",
      clawsweeper_conclusion: null,
      rating: null,
      proof_links: [],
      engine_sha: engineSha,
      executor,
      findings_total: null,
      findings_actionable: null,
      observed_at: null,
      source: "spark-2 openclaw-review + clawsweeper-review",
      prUrl: null,
      proofPaths: [],
    };
    for (const field of [
      "base_sha",
      "ci",
      "ci_conclusion",
      "openclaw",
      "openclaw_conclusion",
      "clawsweeper",
      "clawsweeper_conclusion",
      "rating",
      "findings_total",
      "findings_actionable",
      "observed_at",
      "prUrl",
    ]) {
      if (partial[field] !== undefined && partial[field] !== null && partial[field] !== "unknown") {
        existing[field] = partial[field];
      }
    }
    if (partial.proofPath) existing.proofPaths.push(partial.proofPath);
    if (partial.source) existing.source = partial.source;
    rowsByKey.set(key, existing);
  };

  for (const { record, directoryStatus } of readQueueRecords(options.openclawQueueRoot)) {
    const headSha = sha(record.submitted_head) ?? sha(record.commit_sha) ?? sha(record.head_sha);
    const identity = parsePullIdentity(record.pr_url, record.repo);
    if (!headSha || !identity?.repository || !identity.prNumber) continue;
    const openclaw = openclawFromRecord(record, directoryStatus);
    upsert({
      repository: identity.repository,
      pr_number: identity.prNumber,
      head_sha: headSha,
      base_sha: sha(record.base_sha) ?? sha(record.submitted_base) ?? sha(record.base),
      ...openclaw,
      observed_at: isoDate(record.submitted_at_utc ?? record.observed_at, now),
      prUrl: identity.prUrl,
      proofPath: record.proof_path,
    });
  }

  for (const artifact of readClawsweeperArtifacts(options.reviewStateRoot)) {
    upsert({
      repository: artifact.repository,
      pr_number: artifact.prNumber,
      head_sha: artifact.headSha,
      base_sha: artifact.baseSha,
      ...clawsweeperFromArtifact(artifact),
      observed_at: isoDate(artifact.observedAt, now),
      prUrl: artifact.prUrl,
      proofPath: artifact.proofPath,
    });
  }

  const ghExec = options.ghExec ?? defaultGhExec;
  const rows = [];
  for (const row of rowsByKey.values()) {
    if (options.ciSource === "gh") {
      const payload = ghExec(row.repository, row.head_sha);
      const ci = payload ? summarizeCheckRuns(payload) : { ci: "unknown", ci_conclusion: null };
      row.ci = ci.ci;
      row.ci_conclusion = ci.ci_conclusion;
    } else {
      row.ci = "unknown";
      row.ci_conclusion = null;
    }
    row.proof_links = proofLinksFor(row);
    delete row.prUrl;
    delete row.proofPaths;
    rows.push(row);
  }

  rows.sort((left, right) => {
    const repo = left.repository.localeCompare(right.repository);
    if (repo !== 0) return repo;
    return left.pr_number - right.pr_number;
  });

  return {
    schema_version: SCHEMA_VERSION,
    tenant: TENANT,
    generated_at: generatedAt,
    stale_after_seconds: options.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS,
    lane: { ...SAARI_LANE },
    rows: rows.slice(0, MAX_ROWS),
  };
}

export function writeSaariReviewTelemetry(options) {
  const envelope = buildSaariReviewTelemetry(options);
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(envelope, null, 2)}\n`);
  return envelope;
}

function main(argv = process.argv.slice(2)) {
  const args = parsePublisherArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  writeSaariReviewTelemetry({
    openclawQueueRoot: args.openclawQueueRoot,
    reviewStateRoot: args.reviewStateRoot,
    engineSha: args.engineSha,
    executor: args.executor,
    ciSource: args.ciSource,
    staleAfterSeconds: args.staleAfterSeconds,
    out: args.out,
  });
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "publish failed"}\n`);
    process.exitCode = 2;
  }
}
