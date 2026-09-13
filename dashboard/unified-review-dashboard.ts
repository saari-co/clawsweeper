export type UnifiedDashboardEnv = Record<string, unknown>;

export type Tenant = "saari" | "dinkuskit";
type ReviewState =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "blocked"
  | "skipped"
  | "unknown";

const TENANTS: Tenant[] = ["saari", "dinkuskit"];
const TENANT_BINDINGS: Record<Tenant, string> = {
  saari: "SAARI_REVIEW_TELEMETRY",
  dinkuskit: "DINKUSKIT_REVIEW_TELEMETRY",
};
const SHA_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_ROWS = 500;
const DEFAULT_STALE_AFTER_SECONDS = 600;
const DEFAULT_FEED_TIMEOUT_MS = 3_000;
const MAX_FUTURE_SKEW_MS = 60_000;

export const CLAWSWEEPER_RANKS = [
  "S Challenger Crab",
  "A Diamond Lobster",
  "B Platinum Hermit",
  "C Gold Shrimp",
  "D Silver Shellfish",
  "F Unranked Krab",
  "N/A Off-meta Tidepool",
] as const;

type LaneBoundary = {
  app_installation: string;
  queue_namespace: string;
  state_store: string;
  mutation_authority: string;
};

type UnifiedRow = {
  id: string;
  tenant: Tenant;
  repository: string;
  pr_number: number;
  base_sha: string | null;
  head_sha: string | null;
  ci: ReviewState;
  openclaw: ReviewState;
  clawsweeper: ReviewState;
  rating: (typeof CLAWSWEEPER_RANKS)[number] | null;
  proof_links: string[];
  engine_sha: string | null;
  executor: string | null;
  findings_total: number | null;
  findings_actionable: number | null;
  observed_at: string | null;
  freshness: "fresh" | "stale" | "unknown";
  source: string;
};

type TenantProjection = {
  tenant: Tenant;
  status: "available" | "stale" | "unavailable" | "invalid";
  generated_at: string | null;
  freshness: "fresh" | "stale" | "unknown";
  row_count: number | null;
  lane: LaneBoundary | null;
  error: string | null;
};

type SourceResult = { projection: TenantProjection; rows: UnifiedRow[] };

type AccessJwtHeader = { alg?: unknown; kid?: unknown };
type AccessJwtClaims = {
  aud?: unknown;
  email?: unknown;
  exp?: unknown;
  iat?: unknown;
  iss?: unknown;
  nbf?: unknown;
  sub?: unknown;
};

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

function isoDate(value: unknown, now: number): string | null {
  const text = nonEmptyString(value, 80);
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  const timestamp = Date.parse(text);
  if (timestamp > now + MAX_FUTURE_SKEW_MS) return null;
  return new Date(timestamp).toISOString();
}

function sha(value: unknown): string | null {
  const text = nonEmptyString(value, 40);
  return text && SHA_RE.test(text) ? text.toLowerCase() : null;
}

function state(value: unknown, conclusion?: unknown): ReviewState {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["queued", "pending", "requested", "waiting"].includes(text)) return "pending";
  if (["running", "in_progress", "in-progress"].includes(text)) return "running";
  if (text === "completed") {
    const terminal = typeof conclusion === "string" ? conclusion.trim().toLowerCase() : "";
    if (["success", "successful", "clean", "pass", "passed"].includes(terminal)) {
      return "success";
    }
    if (["failure", "failed", "error", "cancelled", "canceled", "timed_out"].includes(terminal)) {
      return "failure";
    }
    if (["blocked", "needs-human", "needs_human", "human_gate"].includes(terminal)) {
      return "blocked";
    }
    if (["skipped", "not_applicable", "n/a"].includes(terminal)) return "skipped";
    return "unknown";
  }
  if (["success", "successful", "clean", "pass", "passed"].includes(text)) return "success";
  if (["failure", "failed", "error", "cancelled", "canceled", "timed_out"].includes(text))
    return "failure";
  if (["blocked", "needs-human", "needs_human", "human_gate"].includes(text)) return "blocked";
  if (["skipped", "not_applicable", "n/a"].includes(text)) return "skipped";
  return "unknown";
}

function freshness(observedAt: string | null, staleAfterSeconds: number, now: number) {
  if (!observedAt) return "unknown" as const;
  return now - Date.parse(observedAt) > staleAfterSeconds * 1000
    ? ("stale" as const)
    : ("fresh" as const);
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
      // Untrusted telemetry never becomes a rendered link.
    }
  }
  return links;
}

function boundedCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000
    ? value
    : null;
}

function laneBoundary(value: unknown): LaneBoundary | null {
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

function unavailable(
  tenant: Tenant,
  status: TenantProjection["status"],
  error: string,
): SourceResult {
  return {
    projection: {
      tenant,
      status,
      generated_at: null,
      freshness: "unknown",
      row_count: null,
      lane: null,
      error,
    },
    rows: [],
  };
}

export function normalizeTenantFeed(
  tenant: Tenant,
  input: unknown,
  now = Date.now(),
): SourceResult {
  const feed = object(input);
  if (!feed || feed.schema_version !== "clawsweeper.telemetry.v1" || feed.tenant !== tenant) {
    return unavailable(tenant, "invalid", "invalid telemetry envelope");
  }
  const generatedAt = isoDate(feed.generated_at, now);
  const lane = laneBoundary(feed.lane);
  const rawRows = Array.isArray(feed.rows) ? feed.rows : null;
  if (!generatedAt || !lane || !rawRows || rawRows.length > MAX_ROWS) {
    return unavailable(tenant, "invalid", "missing generated_at, lane boundary, or bounded rows");
  }
  const configuredStale = Number(feed.stale_after_seconds);
  const staleAfterSeconds =
    Number.isInteger(configuredStale) && configuredStale >= 30 && configuredStale <= 86_400
      ? configuredStale
      : DEFAULT_STALE_AFTER_SECONDS;
  const sourceFreshness = freshness(generatedAt, staleAfterSeconds, now);
  const rows: UnifiedRow[] = [];
  for (const value of rawRows) {
    const row = object(value);
    if (!row) return unavailable(tenant, "invalid", "telemetry contains a malformed row");
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
      return unavailable(tenant, "invalid", "telemetry contains a malformed row identity");
    }
    const observedAt = isoDate(row.observed_at, now);
    if (row.observed_at !== null && row.observed_at !== undefined && !observedAt) {
      return unavailable(tenant, "invalid", "telemetry contains an invalid observation timestamp");
    }
    const headSha = sha(row.head_sha);
    const rating = CLAWSWEEPER_RANKS.includes(row.rating as (typeof CLAWSWEEPER_RANKS)[number])
      ? (row.rating as (typeof CLAWSWEEPER_RANKS)[number])
      : null;
    rows.push({
      id: `${tenant}:${repository}#${prNumber}:${headSha || "unknown"}`,
      tenant,
      repository,
      pr_number: prNumber,
      base_sha: sha(row.base_sha),
      head_sha: headSha,
      ci: state(row.ci, row.ci_conclusion),
      openclaw: state(row.openclaw, row.openclaw_conclusion),
      clawsweeper: state(row.clawsweeper, row.clawsweeper_conclusion),
      rating,
      proof_links: proofLinks(row.proof_links),
      engine_sha: sha(row.engine_sha),
      executor: nonEmptyString(row.executor, 200),
      findings_total: boundedCount(row.findings_total),
      findings_actionable: boundedCount(row.findings_actionable),
      observed_at: observedAt,
      freshness: freshness(observedAt, staleAfterSeconds, now),
      source,
    });
  }
  return {
    projection: {
      tenant,
      status: sourceFreshness === "stale" ? "stale" : "available",
      generated_at: generatedAt,
      freshness: sourceFreshness,
      row_count: rows.length,
      lane,
      error: null,
    },
    rows,
  };
}

function publicRepositories(env: UnifiedDashboardEnv): Set<string> {
  return new Set(
    String(env.PUBLIC_BAY_REPOS || "")
      .split(",")
      .map((repository) => repository.trim())
      .filter((repository) => REPO_RE.test(repository)),
  );
}

function publicProofLinks(links: string[], repositories: Set<string>): string[] {
  return links.filter((link) => {
    try {
      const url = new URL(link);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        return false;
      }
      const [owner, repository, ...suffix] = url.pathname.split("/").filter(Boolean);
      if (!owner || !repository || !repositories.has(`${owner}/${repository}`)) return false;
      if (suffix.length === 0) return true;
      if (
        suffix.length === 2 &&
        (suffix[0] === "pull" || suffix[0] === "issues") &&
        /^\d+$/.test(suffix[1] || "")
      ) {
        return true;
      }
      return (
        (suffix.length === 3 || suffix.length === 5) &&
        suffix[0] === "actions" &&
        suffix[1] === "runs" &&
        /^\d+$/.test(suffix[2] || "") &&
        (suffix.length === 3 || (suffix[3] === "job" && /^\d+$/.test(suffix[4] || "")))
      );
    } catch {
      return false;
    }
  });
}

function publicResult(result: SourceResult, repositories: Set<string>): SourceResult {
  const rows = result.rows
    .filter((row) => repositories.has(row.repository))
    .map((row) => ({ ...row, proof_links: publicProofLinks(row.proof_links, repositories) }));
  return {
    projection: {
      ...result.projection,
      row_count: result.projection.row_count === null ? null : rows.length,
      lane: null,
      error: result.projection.error ? "telemetry unavailable" : null,
    },
    rows,
  };
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    return null;
  }
}

function accessAudience(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is string => typeof candidate === "string");
}

async function accessJwks(
  env: UnifiedDashboardEnv,
  issuer: string,
): Promise<Array<JsonWebKey & { kid?: string }>> {
  const binding = object(env.PRIVATE_OBSERVER_ACCESS_JWKS);
  const response =
    binding && typeof binding.fetch === "function"
      ? await (binding as { fetch(request: Request): Promise<Response> }).fetch(
          new Request(`${issuer}/cdn-cgi/access/certs`),
        )
      : await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("access verification unavailable");
  const body = object(await response.json());
  return Array.isArray(body?.keys) ? (body.keys as Array<JsonWebKey & { kid?: string }>) : [];
}

export async function authorizePrivateObserver(
  request: Request,
  env: UnifiedDashboardEnv,
  now = Date.now(),
): Promise<boolean> {
  const teamDomain = nonEmptyString(env.PRIVATE_OBSERVER_ACCESS_TEAM_DOMAIN, 253);
  const audience = nonEmptyString(env.PRIVATE_OBSERVER_ACCESS_AUD, 300);
  if (!teamDomain || !audience || !/^[A-Za-z0-9.-]+\.cloudflareaccess\.com$/.test(teamDomain)) {
    return false;
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (!encodedHeader || !encodedClaims || !encodedSignature) return false;
  const header = decodeJwtPart<AccessJwtHeader>(encodedHeader);
  const claims = decodeJwtPart<AccessJwtClaims>(encodedClaims);
  const kid = nonEmptyString(header?.kid, 200);
  const issuer = `https://${teamDomain}`;
  const nowSeconds = Math.floor(now / 1000);
  if (
    header?.alg !== "RS256" ||
    !kid ||
    claims?.iss !== issuer ||
    !accessAudience(claims.aud).includes(audience) ||
    !nonEmptyString(claims.sub, 300) ||
    !nonEmptyString(claims.email, 320) ||
    !Number.isInteger(claims.exp) ||
    Number(claims.exp) <= nowSeconds ||
    (claims.nbf !== undefined &&
      (!Number.isInteger(claims.nbf) || Number(claims.nbf) > nowSeconds)) ||
    (claims.iat !== undefined &&
      (!Number.isInteger(claims.iat) || Number(claims.iat) > nowSeconds + 60))
  ) {
    return false;
  }
  try {
    const jwk = (await accessJwks(env, issuer)).find((candidate) => candidate.kid === kid);
    if (!jwk || jwk.kty !== "RSA") return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(encodedSignature).buffer as ArrayBuffer,
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
    );
  } catch {
    return false;
  }
}

async function readTenantFeed(tenant: Tenant, env: UnifiedDashboardEnv): Promise<unknown> {
  const bindingName = TENANT_BINDINGS[tenant];
  const binding = object(env[bindingName]);
  if (binding && typeof binding.fetch === "function") {
    const fetcher = binding as { fetch(request: Request): Promise<Response> };
    const response = await fetcher.fetch(
      new Request("https://telemetry.internal/v1/reviews/status"),
    );
    if (!response.ok) throw new Error(`telemetry service returned ${response.status}`);
    return response.json();
  }
  if (env.UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES === "1") {
    const raw = env[`${tenant.toUpperCase()}_REVIEW_FEED_JSON`];
    if (typeof raw === "string") return JSON.parse(raw);
  }
  throw new Error(`${bindingName} is unavailable`);
}

function requestedTenant(request: Request): Tenant | "all" {
  const value = new URL(request.url).searchParams.get("tenant");
  return value === "saari" || value === "dinkuskit" ? value : "all";
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("telemetry deadline exceeded")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function unifiedReviewStatus(
  request: Request,
  env: UnifiedDashboardEnv,
  now = Date.now(),
  feedTimeoutMs = DEFAULT_FEED_TIMEOUT_MS,
) {
  const view = requestedTenant(request);
  const tenants: Tenant[] = view === "all" ? TENANTS : [view];
  const results = await Promise.all(
    tenants.map(async (tenant): Promise<SourceResult> => {
      try {
        const feed = await withDeadline(readTenantFeed(tenant, env), feedTimeoutMs);
        return normalizeTenantFeed(tenant, feed, now);
      } catch (error) {
        return unavailable(
          tenant,
          "unavailable",
          error instanceof Error ? error.message : "telemetry unavailable",
        );
      }
    }),
  );
  const repositories = publicRepositories(env);
  const publicResults = results.map((result) => publicResult(result, repositories));
  return new Response(
    JSON.stringify({
      schema_version: "clawsweeper.dashboard.v1",
      generated_at: new Date(now).toISOString(),
      visibility: "public",
      view,
      sources: publicResults.map((result) => result.projection),
      rows: publicResults.flatMap((result) => result.rows),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

export async function privateUnifiedReviewStatus(
  request: Request,
  env: UnifiedDashboardEnv,
  now = Date.now(),
  feedTimeoutMs = DEFAULT_FEED_TIMEOUT_MS,
) {
  if (!(await authorizePrivateObserver(request, env, now))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const view = requestedTenant(request);
  const tenants: Tenant[] = view === "all" ? TENANTS : [view];
  const results = await Promise.all(
    tenants.map(async (tenant): Promise<SourceResult> => {
      try {
        const feed = await withDeadline(readTenantFeed(tenant, env), feedTimeoutMs);
        return normalizeTenantFeed(tenant, feed, now);
      } catch {
        return unavailable(tenant, "unavailable", "telemetry unavailable");
      }
    }),
  );
  return new Response(
    JSON.stringify({
      schema_version: "clawsweeper.dashboard.v1",
      generated_at: new Date(now).toISOString(),
      visibility: "private",
      view,
      sources: results.map((result) => result.projection),
      rows: results.flatMap((result) => result.rows),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

export function unifiedReviewHtml(visibility: "public" | "private" = "public") {
  const endpoint = visibility === "private" ? "/api/private/reviews" : "/api/reviews";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClawSweeper Reviews</title><style>
:root{color-scheme:dark;background:#07131a;color:#eff8f4;font:15px/1.5 ui-sans-serif,system-ui}body{margin:0;padding:28px}main{max-width:1400px;margin:auto}h1{margin:0;font-size:clamp(2rem,6vw,4.5rem)}p{color:#a7beb8}.tabs{display:flex;gap:8px;margin:24px 0}.tabs button{background:#11262d;color:#dff4ee;border:1px solid #31505a;border-radius:999px;padding:9px 16px;cursor:pointer}.tabs button[aria-selected=true]{background:#ff7657;color:#170b08;border-color:#ff7657}.sources,.cards{display:grid;gap:14px}.sources{grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-bottom:18px}.source,.card{background:#0d2028;border:1px solid #29424b;border-radius:16px;padding:16px}.card{display:grid;grid-template-columns:minmax(220px,2fr) repeat(5,minmax(110px,1fr));align-items:start}.label{display:block;color:#78968f;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}.unknown,.stale,.unavailable,.invalid{color:#ffc36a}.success,.fresh,.available{color:#68e0aa}.failure,.blocked{color:#ff8a7a}code{font-size:.78rem;word-break:break-all}a{color:#85d7ff}@media(max-width:950px){.card{grid-template-columns:1fr 1fr}.identity{grid-column:1/-1}}
</style></head><body><main><h1>ClawSweeper</h1><p>One read-only view. Isolated tenant data planes. Exact-head truth.</p>
<div class="tabs" role="tablist"><button data-tenant="all" aria-selected="true">All</button><button data-tenant="saari">Saari</button><button data-tenant="dinkuskit">DinkusKit</button></div>
<section id="sources" class="sources"></section><section id="rows" class="cards" aria-live="polite"></section></main>
<script>
const esc=v=>String(v??'unknown').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=v=>v?esc(v.slice(0,12)):'unknown';
async function load(tenant='all'){
 const response=await fetch('${endpoint}?tenant='+encodeURIComponent(tenant),{cache:'no-store'});
 const data=await response.json();
 if(!response.ok){document.querySelector('#sources').innerHTML='';document.querySelector('#rows').innerHTML='<article class="card"><div class="identity">Private observer authentication required.</div></article>';return;}
 document.querySelectorAll('[data-tenant]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tenant===tenant)));
 document.querySelector('#sources').innerHTML=data.sources.map(s=>'<article class="source"><strong>'+esc(s.tenant)+'</strong> <span class="'+esc(s.status)+'">'+esc(s.status)+'</span><br><span class="label">freshness</span>'+esc(s.freshness)+'<br><span class="label">rows</span>'+esc(s.row_count)+'<br><span class="label">lane boundaries</span>'+esc(s.lane?s.lane.app_installation+' · '+s.lane.queue_namespace+' · '+s.lane.state_store:'unknown')+(s.error?'<br><span class="label">error</span>'+esc(s.error):'')+'</article>').join('');
 document.querySelector('#rows').innerHTML=data.rows.length?data.rows.map(r=>'<article class="card"><div class="identity"><span class="label">tenant · repo / PR</span><strong>'+esc(r.tenant)+' · '+esc(r.repository)+' #'+esc(r.pr_number)+'</strong><br><span class="label">base → head</span><code>'+short(r.base_sha)+' → '+short(r.head_sha)+'</code><br><span class="label">source</span>'+esc(r.source)+'</div><div><span class="label">CI</span><span class="'+esc(r.ci)+'">'+esc(r.ci)+'</span></div><div><span class="label">OpenClaw</span><span class="'+esc(r.openclaw)+'">'+esc(r.openclaw)+'</span></div><div><span class="label">ClawSweeper</span><span class="'+esc(r.clawsweeper)+'">'+esc(r.clawsweeper)+'</span></div><div><span class="label">rating</span>'+esc(r.rating)+'<br><span class="label">findings</span>'+esc(r.findings_total)+' total · '+esc(r.findings_actionable)+' actionable<br><span class="label">executor</span>'+esc(r.executor)+'<br><span class="label">engine</span><code>'+short(r.engine_sha)+'</code></div><div><span class="label">freshness</span><span class="'+esc(r.freshness)+'">'+esc(r.freshness)+'</span><br><span class="label">proof</span>'+r.proof_links.map((u,i)=>'<a href="'+esc(u)+'" rel="noreferrer">proof '+(i+1)+'</a>').join(' · ')+'</div></article>').join(''):'<article class="card"><div class="identity">No known rows. Check source status above; unavailable telemetry is not zero activity.</div></article>';
}
document.querySelectorAll('[data-tenant]').forEach(b=>b.addEventListener('click',()=>load(b.dataset.tenant)));load();
</script></body></html>`;
}
