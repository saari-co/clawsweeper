import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SAARI_EXACT_TUPLE_REVIEW_SCOPE = "comprehensive" as const;
export const SAARI_EXACT_TUPLE_ARTIFACT_PREFIX = "smcbd-suite-review";
export const SAARI_EXACT_TUPLE_ENGINE_REPOSITORY = "saari-co/clawsweeper";
export const SAARI_EXACT_TUPLE_WORKFLOW_PATH = ".github/workflows/saari-exact-tuple-review.yml";

const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,199}$/;

export interface SaariExactTupleTenant {
  repository: string;
  repositoryId: number;
  visibility: "private";
  defaultBranch: string;
  reviewerActor: string;
  reviewScope: typeof SAARI_EXACT_TUPLE_REVIEW_SCOPE;
  artifactPrefix: string;
  publishSideEffects: false;
}

export interface SaariExactTupleIdentity {
  repository: string;
  repositoryId: number;
  itemNumber: number;
  baseSha: string;
  headSha: string;
  reviewEpoch: number;
  reviewScope: typeof SAARI_EXACT_TUPLE_REVIEW_SCOPE;
  reviewerActor: string;
}

export interface SaariExactTupleDispatchInput {
  repository?: string;
  targetRepository?: string;
  targetRepositoryId?: string | number;
  prNumber?: string | number;
  expectedBaseSha?: string;
  expectedHeadSha?: string;
  reviewEpoch?: string | number;
  reviewScope?: string;
  reviewerActor?: string;
  engineSha?: string;
  trustedEngineSha?: string;
}

export interface TrustedEngineIdentityInput {
  engineSha?: string;
  trustedEngineSha?: string;
  trustedEngineRepository?: string;
  trustedEngineFilePath?: string;
  callerSha?: string;
}

export interface TrustedEngineIdentity {
  engineSha: string;
  repository: string;
  filePath: string;
}

const TENANTS = readTenants();

export function saariExactTupleTenants(): readonly SaariExactTupleTenant[] {
  return TENANTS;
}

export function assertTrustedEngineIdentity(
  input: TrustedEngineIdentityInput,
): TrustedEngineIdentity {
  const trustedEngineSha = lowercaseSha(input.trustedEngineSha, "defining-workflow SHA");
  const engineSha = lowercaseSha(input.engineSha, "engine SHA");
  const repository = normalizeRepo(
    requiredText(input.trustedEngineRepository, "defining-workflow repository"),
  );
  const filePath = requiredText(input.trustedEngineFilePath, "defining-workflow file path");
  if (!REPO_PATTERN.test(repository)) {
    throw new Error("defining-workflow repository is invalid");
  }
  if (repository !== SAARI_EXACT_TUPLE_ENGINE_REPOSITORY) {
    throw new Error("defining-workflow repository is not the Saari ClawSweeper producer");
  }
  if (filePath !== SAARI_EXACT_TUPLE_WORKFLOW_PATH) {
    throw new Error("defining-workflow file path is not the Saari exact-tuple producer");
  }
  if (engineSha !== trustedEngineSha) {
    throw new Error("engine SHA is not the trusted defining-workflow commit");
  }
  // Caller suite SHA is accepted as a distinct value and is never the pin.
  void input.callerSha;
  return { engineSha, repository, filePath };
}

export function saariExactTupleTenant(repository: string): SaariExactTupleTenant {
  const normalized = normalizeRepo(repository);
  const tenant = TENANTS.find((candidate) => candidate.repository === normalized);
  if (!tenant) {
    throw new Error(`repository ${repository} is not an admitted Saari exact-tuple tenant`);
  }
  return tenant;
}

export function bindSaariExactTupleIdentity(
  input: SaariExactTupleDispatchInput,
): SaariExactTupleIdentity {
  const repository = normalizeRepo(requiredText(input.repository, "repository"));
  if (!REPO_PATTERN.test(repository)) throw new Error("repository is invalid");
  const tenant = saariExactTupleTenant(repository);
  const targetRepository = normalizeRepo(
    requiredText(input.targetRepository ?? repository, "target repository"),
  );
  const repositoryId = positiveInteger(input.targetRepositoryId, "target repository id");
  const itemNumber = positiveInteger(input.prNumber, "pull request number");
  const baseSha = lowercaseSha(input.expectedBaseSha, "expected base SHA");
  const headSha = lowercaseSha(input.expectedHeadSha, "expected head SHA");
  const reviewEpoch = reviewEpochValue(input.reviewEpoch);
  const reviewScope = requiredText(input.reviewScope, "review scope");
  const callerActor = optionalText(input.reviewerActor);
  const engineSha = optionalText(input.engineSha);
  const trustedEngineSha = optionalText(input.trustedEngineSha);

  if (targetRepository !== tenant.repository || targetRepository !== repository) {
    throw new Error("target repository does not match the admitted tenant");
  }
  if (repositoryId !== tenant.repositoryId) {
    throw new Error("target repository id does not match the admitted tenant");
  }
  if (reviewScope !== tenant.reviewScope || reviewScope !== SAARI_EXACT_TUPLE_REVIEW_SCOPE) {
    throw new Error("review scope must be the admitted comprehensive native scope");
  }
  if (callerActor && callerActor !== tenant.reviewerActor) {
    throw new Error("caller-stamped reviewer actor is not the enrolled producer identity");
  }
  if (engineSha && trustedEngineSha && engineSha !== trustedEngineSha) {
    throw new Error("engine SHA is not the trusted workflow commit");
  }

  return {
    repository: tenant.repository,
    repositoryId: tenant.repositoryId,
    itemNumber,
    baseSha,
    headSha,
    reviewEpoch,
    reviewScope: tenant.reviewScope,
    reviewerActor: tenant.reviewerActor,
  };
}

export function saariExactTupleArtifactName(
  runId: string | number,
  runAttempt: string | number,
): string {
  const run = requiredText(String(runId), "run id");
  const attempt = requiredText(String(runAttempt), "run attempt");
  if (!/^\d{1,30}$/.test(run)) throw new Error("run id is invalid");
  if (!/^[1-9]\d{0,29}$/.test(attempt)) throw new Error("run attempt is invalid");
  return `${SAARI_EXACT_TUPLE_ARTIFACT_PREFIX}-${run}-${attempt}`;
}

export function comprehensiveExactTuplePrompt(identity: SaariExactTupleIdentity): string {
  return [
    "This run is a bound exact-tuple comprehensive ClawSweeper review.",
    `Inspect the full applicable native review scope for ${identity.repository}#${identity.itemNumber}.`,
    `Exact base SHA: ${identity.baseSha}. Exact head SHA: ${identity.headSha}. Review epoch: ${identity.reviewEpoch}.`,
    "Do not narrow the review to P0-only, security-only, or any other reduced scope.",
    "Apply the existing native review schema in full: P0-P3 reviewFindings, proof rating, overall rating, real-behavior proof, security review, agents policy, maintainer decision, and the other required PR review fields.",
    "A P0-only verdict is not a comprehensive review and must not be treated as PASS.",
    `Report reviewer identity is the enrolled producer actor ${identity.reviewerActor}; do not adopt a caller, PR author, or comment-stamped actor.`,
  ].join(" ");
}

export function renderExactTupleIdentitySection(identity: SaariExactTupleIdentity): string {
  return [
    "## Bound Review Identity",
    "",
    `- repository: ${identity.repository}`,
    `- number: ${identity.itemNumber}`,
    `- main_sha: ${identity.baseSha}`,
    `- pull_head_sha: ${identity.headSha}`,
    `- review_epoch: ${identity.reviewEpoch}`,
    `- review_scope: ${identity.reviewScope}`,
    `- reviewer_actor: ${identity.reviewerActor}`,
  ].join("\n");
}

export function exactTupleFrontMatterLines(identity: SaariExactTupleIdentity): string[] {
  return [
    `review_epoch: ${identity.reviewEpoch}`,
    `review_scope: ${identity.reviewScope}`,
    `reviewer_actor: ${identity.reviewerActor}`,
  ];
}

export function assertSaariExactTuplePublishBoundary(source: string): void {
  const forbidden = [
    "apply-artifacts",
    "apply-decisions",
    "clawsweeper-state",
    "sync-comments-only",
    "COPILOT_GITHUB_TOKEN",
    "dinkuskit/clawsweeper-state",
    "dinkuskit-native-clawsweeper-state-writer",
  ];
  for (const token of forbidden) {
    if (source.includes(token)) {
      throw new Error(`Saari exact-tuple producer must not publish through ${token}`);
    }
  }
}

function readTenants(): SaariExactTupleTenant[] {
  const parsed = JSON.parse(
    readFileSync(join(repoRoot(), "config", "saari-exact-tuple-tenants.json"), "utf8"),
  ) as {
    schema_version: number;
    tenants: Array<Record<string, unknown>>;
  };
  if (
    parsed.schema_version !== 1 ||
    !Array.isArray(parsed.tenants) ||
    parsed.tenants.length !== 1
  ) {
    throw new Error("Saari exact-tuple tenant config must admit exactly one initial tenant");
  }
  return parsed.tenants.map((entry, index) => {
    const repository = normalizeRepo(
      requiredText(entry.repository, `tenants[${index}].repository`),
    );
    const reviewScope = requiredText(entry.review_scope, `tenants[${index}].review_scope`);
    if (reviewScope !== SAARI_EXACT_TUPLE_REVIEW_SCOPE) {
      throw new Error(`tenants[${index}].review_scope must remain comprehensive`);
    }
    if (entry.visibility !== "private") {
      throw new Error(`tenants[${index}].visibility must remain private`);
    }
    if (entry.publish_side_effects !== false) {
      throw new Error(`tenants[${index}].publish_side_effects must remain false`);
    }
    const artifactPrefix = requiredText(entry.artifact_prefix, `tenants[${index}].artifact_prefix`);
    if (artifactPrefix !== SAARI_EXACT_TUPLE_ARTIFACT_PREFIX) {
      throw new Error(
        `tenants[${index}].artifact_prefix must remain ${SAARI_EXACT_TUPLE_ARTIFACT_PREFIX}`,
      );
    }
    return {
      repository,
      repositoryId: positiveInteger(entry.repository_id, `tenants[${index}].repository_id`),
      visibility: "private",
      defaultBranch: requiredText(entry.default_branch, `tenants[${index}].default_branch`),
      reviewerActor: actorValue(entry.reviewer_actor, `tenants[${index}].reviewer_actor`),
      reviewScope: SAARI_EXACT_TUPLE_REVIEW_SCOPE,
      artifactPrefix,
      publishSideEffects: false,
    };
  });
}

function normalizeRepo(value: string): string {
  return value.trim().toLowerCase();
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} is required`);
  }
  const text = String(value).trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function optionalText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(requiredText(value, label));
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function reviewEpochValue(value: unknown): number {
  const parsed = Number(requiredText(value, "review epoch"));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("review epoch must be a non-negative integer");
  }
  return parsed;
}

function lowercaseSha(value: unknown, label: string): string {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a lowercase 40-character SHA`);
  return sha;
}

function actorValue(value: unknown, label: string): string {
  const actor = requiredText(value, label);
  if (!ACTOR_PATTERN.test(actor)) throw new Error(`${label} is invalid`);
  return actor;
}

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
