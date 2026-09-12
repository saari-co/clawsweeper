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

function state(value: unknown): ReviewState {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["queued", "pending", "requested", "waiting"].includes(text)) return "pending";
  if (["running", "in_progress", "in-progress"].includes(text)) return "running";
  if (["success", "successful", "completed", "clean", "pass", "passed"].includes(text))
    return "success";
  if (["failure", "failed", "error", "cancelled", "timed_out"].includes(text)) return "failure";
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
      ci: state(row.ci),
      openclaw: state(row.openclaw),
      clawsweeper: state(row.clawsweeper),
      rating,
      proof_links: proofLinks(row.proof_links),
      engine_sha: sha(row.engine_sha),
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
  return new Response(
    JSON.stringify({
      schema_version: "clawsweeper.dashboard.v1",
      generated_at: new Date(now).toISOString(),
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

export function unifiedReviewHtml() {
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
 const data=await fetch('/api/reviews?tenant='+encodeURIComponent(tenant),{cache:'no-store'}).then(r=>r.json());
 document.querySelectorAll('[data-tenant]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tenant===tenant)));
 document.querySelector('#sources').innerHTML=data.sources.map(s=>'<article class="source"><strong>'+esc(s.tenant)+'</strong> <span class="'+esc(s.status)+'">'+esc(s.status)+'</span><br><span class="label">freshness</span>'+esc(s.freshness)+'<br><span class="label">rows</span>'+esc(s.row_count)+'<br><span class="label">lane boundaries</span>'+esc(s.lane?s.lane.app_installation+' · '+s.lane.queue_namespace+' · '+s.lane.state_store:'unknown')+(s.error?'<br><span class="label">error</span>'+esc(s.error):'')+'</article>').join('');
 document.querySelector('#rows').innerHTML=data.rows.length?data.rows.map(r=>'<article class="card"><div class="identity"><span class="label">tenant · repo / PR</span><strong>'+esc(r.tenant)+' · '+esc(r.repository)+' #'+esc(r.pr_number)+'</strong><br><span class="label">base → head</span><code>'+short(r.base_sha)+' → '+short(r.head_sha)+'</code><br><span class="label">source</span>'+esc(r.source)+'</div><div><span class="label">CI</span><span class="'+esc(r.ci)+'">'+esc(r.ci)+'</span></div><div><span class="label">OpenClaw</span><span class="'+esc(r.openclaw)+'">'+esc(r.openclaw)+'</span></div><div><span class="label">ClawSweeper</span><span class="'+esc(r.clawsweeper)+'">'+esc(r.clawsweeper)+'</span></div><div><span class="label">rating</span>'+esc(r.rating)+'<br><span class="label">engine</span><code>'+short(r.engine_sha)+'</code></div><div><span class="label">freshness</span><span class="'+esc(r.freshness)+'">'+esc(r.freshness)+'</span><br><span class="label">proof</span>'+r.proof_links.map((u,i)=>'<a href="'+esc(u)+'" rel="noreferrer">proof '+(i+1)+'</a>').join(' · ')+'</div></article>').join(''):'<article class="card"><div class="identity">No known rows. Check source status above; unavailable telemetry is not zero activity.</div></article>';
}
document.querySelectorAll('[data-tenant]').forEach(b=>b.addEventListener('click',()=>load(b.dataset.tenant)));load();
</script></body></html>`;
}
