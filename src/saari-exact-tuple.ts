import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

export const EXACT_TUPLE_CONFIG_ENV = "CLAWSWEEPER_EXACT_TUPLE_CONFIG";
export const EXACT_TUPLE_REVIEW_SCOPE = "comprehensive" as const;
export const EXACT_TUPLE_WORKFLOW_PATH = ".github/workflows/saari-exact-tuple-review.yml";
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
const ARTIFACT_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

export interface SaariExactTupleTenant {
  repository: string;
  repositoryId: number;
  visibility: "private";
  defaultBranch: string;
  reviewerActor: string;
  reviewScope: typeof EXACT_TUPLE_REVIEW_SCOPE;
  artifactPrefix: string;
  publishSideEffects: false;
}

export interface SaariExactTupleProducerConfig {
  schemaVersion: 1;
  producer: {
    engineRepository: string;
    workflowPath: string;
  };
  tenants: readonly SaariExactTupleTenant[];
}

export interface SaariExactTupleIdentity {
  repository: string;
  repositoryId: number;
  itemNumber: number;
  baseSha: string;
  headSha: string;
  reviewEpoch: number;
  reviewScope: typeof EXACT_TUPLE_REVIEW_SCOPE;
  reviewerActor: string;
  artifactPrefix: string;
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
  githubWorkspace: string;
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

export function exactTupleConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[EXACT_TUPLE_CONFIG_ENV]?.trim();
  if (!configured) {
    throw new Error(
      `${EXACT_TUPLE_CONFIG_ENV} must be an absolute path to the exact-tuple overlay`,
    );
  }
  if (!isAbsolute(configured)) {
    throw new Error(`${EXACT_TUPLE_CONFIG_ENV} must be an absolute path`);
  }
  return configured;
}

export function loadExactTupleConfig(
  env: NodeJS.ProcessEnv = process.env,
): SaariExactTupleProducerConfig {
  return parseExactTupleConfig(readFileSync(exactTupleConfigPath(env), "utf8"));
}

export function parseExactTupleConfig(source: string): SaariExactTupleProducerConfig {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("exact-tuple overlay must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const unexpected = Object.keys(record).filter(
    (key) => !["schema_version", "producer", "tenants"].includes(key),
  );
  if (unexpected.length) {
    throw new Error(`exact-tuple overlay has unsupported keys: ${unexpected.join(", ")}`);
  }
  if (record.schema_version !== 1) {
    throw new Error("exact-tuple overlay schema_version must be 1");
  }
  if (!record.producer || typeof record.producer !== "object" || Array.isArray(record.producer)) {
    throw new Error("exact-tuple overlay producer must be an object");
  }
  const producer = record.producer as Record<string, unknown>;
  const engineRepository = normalizeRepo(
    requiredText(producer.engine_repository, "producer.engine_repository"),
  );
  if (!REPO_PATTERN.test(engineRepository)) {
    throw new Error("producer.engine_repository is invalid");
  }
  const workflowPath = requiredText(producer.workflow_path, "producer.workflow_path");
  if (workflowPath !== EXACT_TUPLE_WORKFLOW_PATH) {
    throw new Error(`producer.workflow_path must remain ${EXACT_TUPLE_WORKFLOW_PATH}`);
  }
  if (!Array.isArray(record.tenants) || record.tenants.length < 1) {
    throw new Error("exact-tuple overlay must admit at least one tenant");
  }
  return {
    schemaVersion: 1,
    producer: { engineRepository, workflowPath },
    tenants: record.tenants.map((entry, index) => parseTenant(entry, index)),
  };
}

export function saariExactTupleTenants(
  config: SaariExactTupleProducerConfig = loadExactTupleConfig(),
): readonly SaariExactTupleTenant[] {
  return config.tenants;
}

export function saariExactTupleTenant(
  repository: string,
  config: SaariExactTupleProducerConfig = loadExactTupleConfig(),
): SaariExactTupleTenant {
  const normalized = normalizeRepo(repository);
  const tenant = config.tenants.find((candidate) => candidate.repository === normalized);
  if (!tenant) {
    throw new Error(`repository ${repository} is not an admitted exact-tuple tenant`);
  }
  return tenant;
}

export function assertTrustedEngineIdentity(
  input: TrustedEngineIdentityInput,
  config: SaariExactTupleProducerConfig = loadExactTupleConfig(),
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
  if (repository !== config.producer.engineRepository) {
    throw new Error("defining-workflow repository is not the configured exact-tuple producer");
  }
  if (filePath !== config.producer.workflowPath) {
    throw new Error("defining-workflow file path is not the exact-tuple producer");
  }
  if (engineSha !== trustedEngineSha) {
    throw new Error("engine SHA is not the trusted defining-workflow commit");
  }
  void input.callerSha;
  return { engineSha, repository, filePath };
}

export function bindSaariExactTupleIdentity(
  input: SaariExactTupleDispatchInput,
  config: SaariExactTupleProducerConfig = loadExactTupleConfig(),
): SaariExactTupleIdentity {
  const repository = normalizeRepo(requiredText(input.repository, "repository"));
  if (!REPO_PATTERN.test(repository)) throw new Error("repository is invalid");
  const tenant = saariExactTupleTenant(repository, config);
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
  if (reviewScope !== tenant.reviewScope || reviewScope !== EXACT_TUPLE_REVIEW_SCOPE) {
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
    artifactPrefix: tenant.artifactPrefix,
  };
}

export function exactTupleIdentityFromReviewArgs(
  args: Record<string, unknown>,
  targetRepoName: string,
  config?: SaariExactTupleProducerConfig,
): SaariExactTupleIdentity | undefined {
  const reviewEpoch = textArg(args.review_epoch);
  const reviewScope = textArg(args.review_scope);
  const reviewerActor = textArg(args.reviewer_actor);
  const expectedBaseSha = textArg(args.expected_base_sha);
  const expectedHeadSha = textArg(args.expected_head_sha);
  const supplied = [reviewEpoch, reviewScope, reviewerActor, expectedBaseSha, expectedHeadSha];
  if (supplied.every((value) => !value)) return undefined;
  if (supplied.some((value) => !value)) {
    throw new Error(
      "exact-tuple review requires --review-epoch, --review-scope, --reviewer-actor, --expected-base-sha, and --expected-head-sha together",
    );
  }
  return bindSaariExactTupleIdentity(
    {
      repository: targetRepoName,
      targetRepository: targetRepoName,
      targetRepositoryId: textArg(args.target_repository_id),
      prNumber: textArg(args.item_number),
      expectedBaseSha,
      expectedHeadSha,
      reviewEpoch,
      reviewScope,
      reviewerActor,
    },
    config ?? loadExactTupleConfig(),
  );
}

export function saariExactTupleArtifactName(
  prefix: string,
  runId: string | number,
  runAttempt: string | number,
): string {
  const artifactPrefix = requiredText(prefix, "artifact prefix");
  if (!ARTIFACT_PREFIX_PATTERN.test(artifactPrefix)) throw new Error("artifact prefix is invalid");
  const run = requiredText(String(runId), "run id");
  const attempt = requiredText(String(runAttempt), "run attempt");
  if (!/^\d{1,30}$/.test(run)) throw new Error("run id is invalid");
  if (!/^[1-9]\d{0,29}$/.test(attempt)) throw new Error("run attempt is invalid");
  return `${artifactPrefix}-${run}-${attempt}`;
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
      throw new Error(`exact-tuple producer must not publish through ${token}`);
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
  githubWorkspace: string;
  runId: string;
  runAttempt: string;
}): SaariSparkIsolatedPaths {
  const runnerTemp = requiredText(input.runnerTemp, "runner temp");
  const githubWorkspace = requiredText(input.githubWorkspace, "github workspace");
  const runId = requiredText(String(input.runId), "run id");
  const runAttempt = requiredText(String(input.runAttempt), "run attempt");
  if (!/^\d{1,30}$/.test(runId)) throw new Error("run id is invalid");
  if (!/^[1-9]\d{0,29}$/.test(runAttempt)) throw new Error("run attempt is invalid");
  const uniqueLeaf = `saari-exact-tuple-${runId}-${runAttempt}`;
  const runRoot = join(runnerTemp, uniqueLeaf);
  const checkout = join(githubWorkspace, uniqueLeaf, "checkout");
  assertActionsCheckoutPathUnderWorkspace(checkout, githubWorkspace);
  return {
    runRoot,
    checkout,
    engine: join(runRoot, "engine"),
    target: join(runRoot, "target"),
    emptyState: join(runRoot, "empty-state"),
    artifacts: join(runRoot, "review-artifacts"),
  };
}

export function resolveActionsCheckoutRepositoryPath(
  repositoryPath: string,
  githubWorkspace: string,
): string {
  const workspace = resolve(requiredText(githubWorkspace, "github workspace"));
  return resolve(workspace, requiredText(repositoryPath, "repository path"));
}

export function isActionsCheckoutPathUnderWorkspace(
  repositoryPath: string,
  githubWorkspace: string,
): boolean {
  const workspace = resolve(requiredText(githubWorkspace, "github workspace"));
  const resolved = resolveActionsCheckoutRepositoryPath(repositoryPath, workspace);
  return `${resolved}${sep}`.startsWith(`${workspace}${sep}`);
}

export function assertActionsCheckoutPathUnderWorkspace(
  repositoryPath: string,
  githubWorkspace: string,
): string {
  const workspace = resolve(requiredText(githubWorkspace, "github workspace"));
  const resolved = resolveActionsCheckoutRepositoryPath(repositoryPath, workspace);
  if (!`${resolved}${sep}`.startsWith(`${workspace}${sep}`)) {
    throw new Error(`Repository path '${resolved}' is not under '${workspace}'`);
  }
  return resolved;
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

export function assertSaariSparkPathsIsolated(
  paths: SaariSparkIsolatedPaths,
  home: string,
  locations: { githubWorkspace: string; runnerTemp: string },
): void {
  const lockFile = saariSparkCommandLockPath(home);
  const shared = [
    join(requiredHome(home), ".cache", "clawsweeper", "targets"),
    join(requiredHome(home), ".local", "state", "clawsweeper-review"),
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
  assertActionsCheckoutPathUnderWorkspace(paths.checkout, locations.githubWorkspace);
  if (isActionsCheckoutPathUnderWorkspace(paths.checkout, locations.runnerTemp)) {
    throw new Error("trusted checkout must not live under runner temp");
  }
  for (const staged of [
    paths.runRoot,
    paths.engine,
    paths.target,
    paths.emptyState,
    paths.artifacts,
  ]) {
    if (
      !isNestedPath(resolve(staged), resolve(requiredText(locations.runnerTemp, "runner temp")))
    ) {
      throw new Error("staged producer path must remain under runner temp");
    }
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
    "set-safe-directory: false",
    "path: saari-exact-tuple-${{ github.run_id }}-${{ github.run_attempt }}/checkout",
    EXACT_TUPLE_CONFIG_ENV,
  ];
  for (const token of required) {
    if (!source.includes(token)) {
      throw new Error(`Saari Spark producer is missing required host-reuse contract (${token})`);
    }
  }
  if (source.includes("danger-full-access")) {
    throw new Error("Saari Spark producer must keep the read-only Codex sandbox");
  }
  if (source.includes(".cache/clawsweeper/targets")) {
    throw new Error("Saari Spark producer must not reset shared Spark target checkouts");
  }
}

export function prepareSaariSparkExactTupleRun(input: {
  identity: SaariExactTupleDispatchInput;
  engine: TrustedEngineIdentityInput;
  host: SaariSparkHostContext;
  config?: SaariExactTupleProducerConfig;
}): SaariSparkExactTupleRun {
  const config = input.config ?? loadExactTupleConfig(input.host.env);
  const engine = assertTrustedEngineIdentity(input.engine, config);
  const identity = bindSaariExactTupleIdentity(input.identity, config);
  const paths = saariSparkIsolatedPaths(input.host);
  const lockFile = saariSparkCommandLockPath(input.host.home);
  const codexHome = saariSparkCodexHomePath(input.host.home);
  assertSaariSparkPathsIsolated(paths, input.host.home, {
    githubWorkspace: input.host.githubWorkspace,
    runnerTemp: input.host.runnerTemp,
  });
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

function parseTenant(entry: unknown, index: number): SaariExactTupleTenant {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`tenants[${index}] must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const repository = normalizeRepo(requiredText(record.repository, `tenants[${index}].repository`));
  if (!REPO_PATTERN.test(repository)) {
    throw new Error(`tenants[${index}].repository is invalid`);
  }
  const reviewScope = requiredText(record.review_scope, `tenants[${index}].review_scope`);
  if (reviewScope !== EXACT_TUPLE_REVIEW_SCOPE) {
    throw new Error(`tenants[${index}].review_scope must remain comprehensive`);
  }
  if (record.visibility !== "private") {
    throw new Error(`tenants[${index}].visibility must remain private`);
  }
  if (record.publish_side_effects !== false) {
    throw new Error(`tenants[${index}].publish_side_effects must remain false`);
  }
  const artifactPrefix = requiredText(record.artifact_prefix, `tenants[${index}].artifact_prefix`);
  if (!ARTIFACT_PREFIX_PATTERN.test(artifactPrefix)) {
    throw new Error(`tenants[${index}].artifact_prefix is invalid`);
  }
  return {
    repository,
    repositoryId: positiveInteger(record.repository_id, `tenants[${index}].repository_id`),
    visibility: "private",
    defaultBranch: requiredText(record.default_branch, `tenants[${index}].default_branch`),
    reviewerActor: actorValue(record.reviewer_actor, `tenants[${index}].reviewer_actor`),
    reviewScope: EXACT_TUPLE_REVIEW_SCOPE,
    artifactPrefix,
    publishSideEffects: false,
  };
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

function textArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(requiredText(value, label));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
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
