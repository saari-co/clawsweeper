import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SAARI_EXACT_TUPLE_REVIEW_SCOPE = "comprehensive" as const;
export const SAARI_EXACT_TUPLE_ARTIFACT_PREFIX = "smcbd-suite-review";
export const SAARI_EXACT_TUPLE_ENGINE_REPOSITORY = "saari-co/clawsweeper";
export const SAARI_EXACT_TUPLE_WORKFLOW_PATH = ".github/workflows/saari-exact-tuple-review.yml";
export const SAARI_SPARK_ADMIT_RUNNER = "ubuntu-latest";
export const SAARI_SPARK_RUNNER_LABELS = ["self-hosted", "spark-2"] as const;
export const SAARI_SPARK_LOGIN_METHOD = "chatgpt" as const;
export const SAARI_SPARK_CODEX_SANDBOX = "read-only" as const;
export const SAARI_SPARK_CODEX_MODEL_ALIAS = "internal" as const;
export const SAARI_SPARK_KNOWN_BIN_DIR_RELATIVE = ".local/bin";
export const SAARI_SPARK_KNOWN_EXECUTABLE_NAMES = ["node", "gh", "codex"] as const;
export const SAARI_SPARK_COMMAND_LOCK_RELATIVE = ".cache/clawsweeper/clawsweeper-command.lock";
export const SAARI_SPARK_CODEX_HOME_RELATIVE = ".config/clawsweeper/codex-home";

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

export interface SaariSparkHostContext {
  home: string;
  runnerTemp: string;
  runId: string;
  runAttempt: string;
  env?: NodeJS.ProcessEnv;
  exists?: (absolutePath: string) => boolean;
  isExecutable?: (absolutePath: string) => boolean;
}

export interface SaariSparkIsolatedPaths {
  runRoot: string;
  checkout: string;
  engine: string;
  target: string;
  emptyState: string;
  artifacts: string;
}

export interface SaariSparkExactTupleRun {
  identity: SaariExactTupleIdentity;
  engine: TrustedEngineIdentity;
  paths: SaariSparkIsolatedPaths;
  lockFile: string;
  codexHome: string;
  loginMethod: typeof SAARI_SPARK_LOGIN_METHOD;
  sandbox: typeof SAARI_SPARK_CODEX_SANDBOX;
  modelAlias: typeof SAARI_SPARK_CODEX_MODEL_ALIAS;
  executables: Record<(typeof SAARI_SPARK_KNOWN_EXECUTABLE_NAMES)[number], string>;
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

export function saariSparkCommandLockPath(home: string): string {
  return join(requiredHome(home), ".cache", "clawsweeper", "clawsweeper-command.lock");
}

export function saariSparkCodexHomePath(home: string): string {
  return join(requiredHome(home), ".config", "clawsweeper", "codex-home");
}

export function saariSparkKnownBinDir(home: string): string {
  return join(requiredHome(home), ".local", "bin");
}

export function saariSparkIsolatedPaths(input: {
  runnerTemp: string;
  runId: string;
  runAttempt: string;
}): SaariSparkIsolatedPaths {
  const runnerTemp = requiredText(input.runnerTemp, "runner temp");
  const runId = requiredText(String(input.runId), "run id");
  const runAttempt = requiredText(String(input.runAttempt), "run attempt");
  if (!/^\d{1,30}$/.test(runId)) throw new Error("run id is invalid");
  if (!/^[1-9]\d{0,29}$/.test(runAttempt)) throw new Error("run attempt is invalid");
  const runRoot = join(runnerTemp, `saari-exact-tuple-${runId}-${runAttempt}`);
  return {
    runRoot,
    checkout: join(runRoot, "checkout"),
    engine: join(runRoot, "engine"),
    target: join(runRoot, "target"),
    emptyState: join(runRoot, "empty-state"),
    artifacts: join(runRoot, "review-artifacts"),
  };
}

export function resolveSaariSparkKnownExecutable(
  name: (typeof SAARI_SPARK_KNOWN_EXECUTABLE_NAMES)[number],
  host: Pick<SaariSparkHostContext, "home" | "env" | "exists" | "isExecutable">,
): string {
  if (!SAARI_SPARK_KNOWN_EXECUTABLE_NAMES.includes(name)) {
    throw new Error(`${name} is not a source-owned Spark executable`);
  }
  const isExecutable = host.isExecutable ?? pathIsExecutable;
  if (name === "codex") {
    const configured = optionalText(host.env?.CODEX_BIN);
    if (configured) {
      if (!isExecutable(configured)) {
        throw new Error("CODEX_BIN is set but is not an executable");
      }
      return configured;
    }
  }
  const known = join(saariSparkKnownBinDir(host.home), name);
  if (isExecutable(known)) return known;
  const pathEntries = String(host.env?.PATH ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, name);
    if (isExecutable(candidate)) return candidate;
  }
  throw new Error(`required ${name} executable is absent from known paths`);
}

export function assertSaariSparkSubscriptionProfile(
  codexHome: string,
  host: Pick<SaariSparkHostContext, "exists"> = {},
): void {
  const exists = host.exists ?? pathExists;
  if (!exists(codexHome)) {
    throw new Error("existing Spark-2 Codex subscription profile is absent");
  }
  if (!exists(join(codexHome, "auth.json"))) {
    throw new Error("existing Spark-2 Codex subscription auth is absent");
  }
}

export function assertSaariSparkPathsIsolated(paths: SaariSparkIsolatedPaths, home: string): void {
  const lockFile = saariSparkCommandLockPath(home);
  const shared = [
    join(requiredHome(home), ".cache", "clawsweeper", "targets", "spark-dgx"),
    join(requiredHome(home), ".cache", "clawsweeper", "targets", "x-api"),
    join(requiredHome(home), ".local", "state", "clawsweeper-review"),
    join(requiredHome(home), "Developer", "clawsweeper"),
    saariSparkCodexHomePath(home),
  ];
  const isolated = [
    paths.runRoot,
    paths.checkout,
    paths.engine,
    paths.target,
    paths.emptyState,
    paths.artifacts,
  ];
  for (const isolatedPath of isolated) {
    for (const sharedPath of shared) {
      if (pathsOverlap(isolatedPath, sharedPath)) {
        throw new Error("isolated producer path collides with shared Spark host state");
      }
    }
    if (pathsOverlap(isolatedPath, lockFile) && isolatedPath !== paths.runRoot) {
      throw new Error("shared command lock must remain outside isolated producer trees");
    }
  }
  if (
    isolated.some(
      (isolatedPath) => lockFile === isolatedPath || isNestedPath(lockFile, isolatedPath),
    )
  ) {
    throw new Error("shared command lock must remain outside the per-run tree");
  }
}

export function assertSaariSparkNoApiCredentialSetup(source: string): void {
  const forbidden = [
    "setup-codex",
    "secrets.OPENAI_API_KEY",
    "secrets.CLAWSWEEPER_MODEL",
    "codex login",
    "OPENAI_API_KEY: ${{ secrets",
    "CLAWSWEEPER_INTERNAL_MODEL: ${{ secrets",
  ];
  for (const token of forbidden) {
    if (source.includes(token)) {
      throw new Error(`Saari Spark producer must not use API credential setup (${token})`);
    }
  }
}

export function assertSaariSparkNoGlobalAuthWrites(source: string): void {
  const forbidden = [
    "mint-token",
    "setup-codex",
    "codex login",
    "cp ",
    "install -m",
    '>> "$CODEX_HOME',
    '>> "$codex_home',
    "~/.codex/",
    ".codex/auth.json",
    "config.toml",
  ];
  for (const token of forbidden) {
    if (source.includes(token)) {
      throw new Error(
        `Saari Spark producer must not write host auth or copy credentials (${token})`,
      );
    }
  }
}

export function assertSaariSparkHostReuseContract(source: string): void {
  assertSaariExactTuplePublishBoundary(source);
  assertSaariSparkNoApiCredentialSetup(source);
  assertSaariSparkNoGlobalAuthWrites(source);
  const required = [
    "ubuntu-latest",
    "[self-hosted, spark-2]",
    "CLAWSWEEPER_CODEX_LOGIN_METHOD",
    "chatgpt",
    ".cache/clawsweeper/clawsweeper-command.lock",
    "--codex-sandbox read-only",
    "--codex-forced-login-method chatgpt",
    "--codex-model internal",
    "flock",
    "Reject stale exact-tuple identity before host work",
  ];
  for (const token of required) {
    if (!source.includes(token)) {
      throw new Error(`Saari Spark producer is missing required host-reuse contract (${token})`);
    }
  }
  if (source.includes("danger-full-access")) {
    throw new Error("Saari Spark producer must keep the read-only Codex sandbox");
  }
  if (source.includes("/opt/saari-clawsweeper-exact-tuple")) {
    throw new Error("Saari Spark producer must not reuse the hosted /opt producer root");
  }
  if (source.includes("targets/spark-dgx") || source.includes("targets/x-api")) {
    throw new Error("Saari Spark producer must not reset shared Spark target checkouts");
  }
}

export function prepareSaariSparkExactTupleRun(input: {
  identity: SaariExactTupleDispatchInput;
  engine: TrustedEngineIdentityInput;
  host: SaariSparkHostContext;
}): SaariSparkExactTupleRun {
  const engine = assertTrustedEngineIdentity(input.engine);
  const identity = bindSaariExactTupleIdentity(input.identity);
  const paths = saariSparkIsolatedPaths(input.host);
  const lockFile = saariSparkCommandLockPath(input.host.home);
  const codexHome = saariSparkCodexHomePath(input.host.home);
  assertSaariSparkPathsIsolated(paths, input.host.home);
  assertSaariSparkSubscriptionProfile(codexHome, input.host);
  const executables = {
    node: resolveSaariSparkKnownExecutable("node", input.host),
    gh: resolveSaariSparkKnownExecutable("gh", input.host),
    codex: resolveSaariSparkKnownExecutable("codex", input.host),
  };
  return {
    identity,
    engine,
    paths,
    lockFile,
    codexHome,
    loginMethod: SAARI_SPARK_LOGIN_METHOD,
    sandbox: SAARI_SPARK_CODEX_SANDBOX,
    modelAlias: SAARI_SPARK_CODEX_MODEL_ALIAS,
    executables,
  };
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

function requiredHome(home: string): string {
  return requiredText(home, "host home");
}

function pathExists(absolutePath: string): boolean {
  return existsSync(absolutePath);
}

function pathIsExecutable(absolutePath: string): boolean {
  try {
    accessSync(absolutePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isNestedPath(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(`${outer}/`);
}

function pathsOverlap(left: string, right: string): boolean {
  return isNestedPath(left, right) || isNestedPath(right, left);
}
