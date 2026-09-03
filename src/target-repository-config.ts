import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const TARGET_REPOSITORY_PROFILE_OVERLAY_ENV = "CLAWSWEEPER_REPOSITORY_PROFILE_OVERLAY";

type JsonObject = Record<string, unknown>;

export function targetRepositoryProfileOverlayPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env[TARGET_REPOSITORY_PROFILE_OVERLAY_ENV]?.trim();
  if (!configured) return null;
  if (!isAbsolute(configured)) {
    throw new Error(`${TARGET_REPOSITORY_PROFILE_OVERLAY_ENV} must be an absolute path`);
  }
  return configured;
}

export function targetRepositoryConfigCacheKey(
  bundledPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `${bundledPath}\0${targetRepositoryProfileOverlayPath(env) ?? ""}`;
}

export function readTargetRepositoryConfigSource(
  bundledPath: string,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  const bundled = readJsonObject(bundledPath, "bundled target repository config");
  const overlayPath = targetRepositoryProfileOverlayPath(env);
  if (!overlayPath) return bundled;

  const overlay = readJsonObject(overlayPath, "target repository profile overlay");
  const unexpected = Object.keys(overlay).filter(
    (key) => !["schema_version", "repositories", "generic_fallbacks"].includes(key),
  );
  if (unexpected.length) {
    throw new Error(
      `target repository profile overlay has unsupported keys: ${unexpected.join(", ")}`,
    );
  }
  if (overlay.schema_version !== bundled.schema_version) {
    throw new Error(
      `target repository profile overlay schema_version must match bundled schema_version ${String(
        bundled.schema_version,
      )}`,
    );
  }

  return {
    ...bundled,
    repositories: appendUniqueEntries(
      bundled.repositories,
      overlay.repositories,
      "target_repo",
      "repository",
    ),
    generic_fallbacks: appendUniqueEntries(
      bundled.generic_fallbacks ?? [],
      overlay.generic_fallbacks,
      "owner",
      "generic fallback",
    ),
  };
}

function readJsonObject(filePath: string, label: string): JsonObject {
  if (!existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonObject;
}

function appendUniqueEntries(
  bundledValue: unknown,
  overlayValue: unknown,
  identityKey: string,
  label: string,
): unknown[] {
  if (!Array.isArray(bundledValue)) {
    throw new Error(`bundled target repository config ${label} entries must be an array`);
  }
  if (overlayValue === undefined) return bundledValue;
  if (!Array.isArray(overlayValue)) {
    throw new Error(`target repository profile overlay ${label} entries must be an array`);
  }

  const identities = new Set(
    bundledValue.map((entry, index) =>
      entryIdentity(entry, identityKey, `bundled ${label}[${index}]`),
    ),
  );
  for (const [index, entry] of overlayValue.entries()) {
    const identity = entryIdentity(entry, identityKey, `overlay ${label}[${index}]`);
    if (identities.has(identity)) {
      throw new Error(
        `target repository profile overlay cannot replace bundled ${label}: ${identity}`,
      );
    }
    identities.add(identity);
  }
  return [...bundledValue, ...overlayValue];
}

function entryIdentity(entry: unknown, identityKey: string, label: string): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${label} must be an object`);
  }
  const identity = (entry as JsonObject)[identityKey];
  if (typeof identity !== "string" || !identity.trim()) {
    throw new Error(`${label}.${identityKey} must be a string`);
  }
  return identity.trim().toLowerCase();
}
