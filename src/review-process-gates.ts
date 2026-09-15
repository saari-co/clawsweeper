import { createHash } from "node:crypto";
import type { Decision } from "./clawsweeper-types.js";
import type { SaariExactTupleIdentity, SaariExactTupleTenant } from "./saari-exact-tuple.js";

export const PROCESS_GATES = ["own_current_check", "owner_merge_authority"] as const;
export type ProcessGate = (typeof PROCESS_GATES)[number];

/** Model reasons are proposals, never trusted check identities. */
export function parseProcessGates(value: unknown): ProcessGate[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((entry) => !PROCESS_GATES.includes(entry)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("processGates must be a unique array of supported process gates");
  }
  return [...value] as ProcessGate[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Inputs must come from the runner's GitHub API, never PR text or model output. */
export function qualifyOwnCurrentCheck(
  identity: SaariExactTupleIdentity,
  tenant: SaariExactTupleTenant,
  pullValue: unknown,
  checksValue: unknown,
): boolean {
  const enrollment = tenant.processGateCheck;
  if (
    !enrollment ||
    tenant.repository !== identity.repository ||
    tenant.repositoryId !== identity.repositoryId
  )
    return false;
  const pull = record(pullValue);
  const base = record(pull.base);
  const head = record(pull.head);
  const repo = record(base.repo);
  if (
    pull.number !== identity.itemNumber ||
    pull.state !== "open" ||
    base.sha !== identity.baseSha ||
    head.sha !== identity.headSha ||
    repo.full_name !== identity.repository ||
    repo.id !== identity.repositoryId
  )
    return false;
  const checks = record(checksValue);
  if (
    !Array.isArray(checks.check_runs) ||
    checks.total_count !== checks.check_runs.length ||
    checks.check_runs.length > 100
  )
    return false;
  const externalId =
    "review-conductor:" +
    createHash("sha256")
      .update(
        `${identity.repository}|${identity.itemNumber}|${identity.baseSha}|${identity.headSha}|${identity.reviewEpoch}|${enrollment.name}`,
      )
      .digest("hex");
  const matches = checks.check_runs
    .map(record)
    .filter(
      (check) =>
        check.name === enrollment.name &&
        record(check.app).id === enrollment.appId &&
        check.external_id === externalId &&
        check.head_sha === identity.headSha,
    );
  return (
    matches.length === 1 &&
    ["queued", "in_progress"].includes(String(matches[0]?.status)) &&
    matches[0]?.conclusion === null
  );
}

/** Do not invent gates, change grades, or mask findings/proof/human decisions. */
export function validateDecisionProcessGates(
  decision: Decision,
  ownCurrentCheck: boolean,
  terminalSucceeded = true,
): Decision {
  const gates = parseProcessGates(decision.processGates);
  if (gates?.length && !terminalSucceeded) {
    throw new Error("process gates cannot qualify a failed terminal execution");
  }
  if (gates?.includes("own_current_check") && !ownCurrentCheck) {
    throw new Error("own_current_check lacks runner-qualified exact-tuple evidence");
  }
  if (gates?.length && decision.decision !== "keep_open") {
    throw new Error("process gates are only valid for keep_open");
  }
  return decision;
}
