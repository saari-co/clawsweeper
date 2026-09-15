/**
 * Read-only tenant telemetry feeder. Serves the clawsweeper.telemetry.v1
 * envelope that dashboard/unified-review-dashboard.ts normalizeTenantFeed()
 * accepts. Carries no writer secret and no GitHub App private key.
 */

export type TelemetryFeederEnv = {
  TENANT?: string;
  TELEMETRY_SOURCE_REPO?: string;
  TELEMETRY_SOURCE_REF?: string;
  TELEMETRY_SOURCE_PATH?: string;
  TELEMETRY_SOURCE_TOKEN?: string;
  STALE_AFTER_SECONDS?: string;
};

export type TelemetryFeederOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  cacheTtlMs?: number;
};

const SCHEMA_VERSION = "clawsweeper.telemetry.v1";
const STATUS_PATH = "/v1/reviews/status";
const SHA_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TENANTS = new Set(["saari", "dinkuskit"]);

/** Matches dashboard/unified-review-dashboard.ts MAX_ROWS. */
export const MAX_TELEMETRY_ROWS = 500;
export const TELEMETRY_FETCH_TIMEOUT_MS = 5_000;
export const TELEMETRY_MAX_BODY_BYTES = 1024 * 1024;
export const TELEMETRY_CACHE_TTL_MS = 30_000;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

type CachedEnvelope = { expiresAt: number; body: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function unavailable(tenant: string, reason: string): Response {
  return jsonResponse(503, {
    schema_version: SCHEMA_VERSION,
    tenant,
    status: "unavailable",
    reason,
  });
}

function notFound(): Response {
  return jsonResponse(404, { error: "not found" });
}

function isoDate(value: unknown): string | null {
  const text = nonEmptyString(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(Date.parse(text)).toISOString();
}

function laneBoundary(value: unknown): Record<string, string> | null {
  const lane = object(value);
  if (!lane) return null;
  const app = nonEmptyString(lane.app_installation);
  const queue = nonEmptyString(lane.queue_namespace);
  const store = nonEmptyString(lane.state_store);
  const authority = nonEmptyString(lane.mutation_authority);
  if (!app || !queue || !store || !authority) return null;
  return {
    app_installation: app,
    queue_namespace: queue,
    state_store: store,
    mutation_authority: authority,
  };
}

function proofLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const links: string[] = [];
  for (const candidate of value.slice(0, 20)) {
    const text = nonEmptyString(candidate, 2_000);
    if (!text) continue;
    try {
      const url = new URL(text);
      if (url.protocol === "https:") links.push(url.toString());
    } catch {
      // Drop untrusted or non-https candidates.
    }
  }
  return links;
}

function sha(value: unknown): string | null {
  const text = nonEmptyString(value, 40);
  return text && SHA_RE.test(text) ? text.toLowerCase() : null;
}

function boundedCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000
    ? value
    : null;
}

function lifecycle(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function sanitizeRow(value: unknown): Record<string, unknown> | null {
  const row = object(value);
  if (!row) return null;
  const repository = nonEmptyString(row.repository, 200);
  const prNumber = Number(row.pr_number);
  const source = nonEmptyString(row.source, 300);
  if (
    !repository ||
    !REPO_RE.test(repository) ||
    !Number.isInteger(prNumber) ||
    prNumber < 1 ||
    !source
  ) {
    return null;
  }
  if (row.observed_at !== null && row.observed_at !== undefined && !isoDate(row.observed_at)) {
    return null;
  }
  const sanitized: Record<string, unknown> = {
    repository,
    pr_number: prNumber,
    base_sha: sha(row.base_sha),
    head_sha: sha(row.head_sha),
    ci: lifecycle(row.ci) ?? "unknown",
    ci_conclusion: lifecycle(row.ci_conclusion),
    openclaw: lifecycle(row.openclaw) ?? "unknown",
    openclaw_conclusion: lifecycle(row.openclaw_conclusion),
    clawsweeper: lifecycle(row.clawsweeper) ?? "unknown",
    clawsweeper_conclusion: lifecycle(row.clawsweeper_conclusion),
    rating: typeof row.rating === "string" ? row.rating : null,
    proof_links: proofLinks(row.proof_links),
    engine_sha: sha(row.engine_sha),
    executor: nonEmptyString(row.executor, 200),
    findings_total: boundedCount(row.findings_total),
    findings_actionable: boundedCount(row.findings_actionable),
    observed_at:
      row.observed_at === null || row.observed_at === undefined ? null : isoDate(row.observed_at),
    source,
  };
  return sanitized;
}

function sanitizeEnvelope(input: unknown, tenant: string): Record<string, unknown> | null {
  const feed = object(input);
  if (!feed || feed.schema_version !== SCHEMA_VERSION) return null;
  if (feed.tenant !== tenant) return null;
  const generatedAt = isoDate(feed.generated_at);
  const lane = laneBoundary(feed.lane);
  if (!generatedAt || !lane || !Array.isArray(feed.rows)) return null;
  if (feed.rows.length > MAX_TELEMETRY_ROWS * 4) return null;
  const rows: Record<string, unknown>[] = [];
  for (const value of feed.rows.slice(0, MAX_TELEMETRY_ROWS)) {
    const row = sanitizeRow(value);
    if (!row) return null;
    rows.push(row);
  }
  const configuredStale = Number(feed.stale_after_seconds);
  const staleAfterSeconds =
    Number.isInteger(configuredStale) && configuredStale >= 30 && configuredStale <= 86_400
      ? configuredStale
      : 600;
  return {
    schema_version: SCHEMA_VERSION,
    tenant,
    generated_at: generatedAt,
    stale_after_seconds: staleAfterSeconds,
    lane,
    rows,
  };
}

function contentsUrl(repo: string, ref: string, filePath: string): string | null {
  if (!REPO_RE.test(repo)) return null;
  const normalized = filePath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("\\") || normalized.includes("..")) return null;
  const encodedPath = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
}

function decodeGithubContent(payload: Record<string, unknown>): string | null {
  const encoding = nonEmptyString(payload.encoding, 40);
  const content = typeof payload.content === "string" ? payload.content : null;
  if (!content || (encoding && encoding !== "base64")) return null;
  try {
    const compact = content.replace(/\s+/g, "");
    const bytes = Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function readBoundedBody(
  response: Response,
  maxBodyBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: "oversized" | "unreadable" }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBodyBytes)
    return { ok: false, reason: "oversized" };
  try {
    if (!response.body) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > maxBodyBytes) return { ok: false, reason: "oversized" };
      return { ok: true, text: new TextDecoder().decode(buffer) };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        return { ok: false, reason: "oversized" };
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder().decode(merged) };
  } catch (error) {
    void error;
    return { ok: false, reason: "unreadable" };
  }
}

function parseSourceDocument(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  const payload = object(parsed);
  if (payload && typeof payload.content === "string") {
    const decoded = decodeGithubContent(payload);
    if (decoded === null) throw new Error("malformed");
    return JSON.parse(decoded);
  }
  return parsed;
}

export function createTelemetryFeeder(options: TelemetryFeederOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? TELEMETRY_FETCH_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? TELEMETRY_MAX_BODY_BYTES;
  const cacheTtlMs = options.cacheTtlMs ?? TELEMETRY_CACHE_TTL_MS;
  let cache: CachedEnvelope | null = null;

  return async function fetchTelemetry(
    request: Request,
    env: TelemetryFeederEnv,
  ): Promise<Response> {
    const tenant = nonEmptyString(env.TENANT, 40) ?? "";
    let url: URL;
    try {
      url = new URL(request.url);
    } catch (error) {
      void error;
      return unavailable(TENANTS.has(tenant) ? tenant : "unknown", "invalid request");
    }
    if (request.method !== "GET" || url.pathname !== STATUS_PATH) return notFound();
    if (!TENANTS.has(tenant)) return unavailable(tenant || "unknown", "source unavailable");

    if (cache && cache.expiresAt > now()) {
      return new Response(cache.body, { status: 200, headers: JSON_HEADERS });
    }

    const repo = nonEmptyString(env.TELEMETRY_SOURCE_REPO, 200);
    const ref = nonEmptyString(env.TELEMETRY_SOURCE_REF, 200);
    const filePath = nonEmptyString(env.TELEMETRY_SOURCE_PATH, 500);
    const token = nonEmptyString(env.TELEMETRY_SOURCE_TOKEN, 8_000);
    const sourceUrl = repo && ref && filePath ? contentsUrl(repo, ref, filePath) : null;
    if (!sourceUrl || !token) return unavailable(tenant, "source unavailable");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(sourceUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "clawsweeper-telemetry-feeder",
        },
      });
    } catch (error) {
      const timedOut =
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof DOMException && error.name === "AbortError");
      return unavailable(tenant, timedOut ? "telemetry timeout" : "source unavailable");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return unavailable(tenant, "source unavailable");

    const body = await readBoundedBody(response, maxBodyBytes);
    if ("reason" in body) {
      return unavailable(
        tenant,
        body.reason === "oversized" ? "telemetry oversized" : "source unavailable",
      );
    }

    let parsed: unknown;
    try {
      parsed = parseSourceDocument(body.text);
    } catch (error) {
      void error;
      return unavailable(tenant, "malformed telemetry");
    }

    const feed = object(parsed);
    if (feed && feed.schema_version === SCHEMA_VERSION && feed.tenant !== tenant) {
      return unavailable(tenant, "tenant mismatch");
    }

    const envelope = sanitizeEnvelope(parsed, tenant);
    if (!envelope) return unavailable(tenant, "malformed telemetry");

    const serialized = JSON.stringify(envelope);
    cache = { expiresAt: now() + cacheTtlMs, body: serialized };
    return new Response(serialized, { status: 200, headers: JSON_HEADERS });
  };
}

const fetchTelemetry = createTelemetryFeeder();

export default {
  fetch(request: Request, env: TelemetryFeederEnv): Promise<Response> {
    return fetchTelemetry(request, env);
  },
};
