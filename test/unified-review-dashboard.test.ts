import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dashboard/worker.ts";
import {
  authorizePrivateObserver,
  CLAWSWEEPER_RANKS,
  normalizeTenantFeed,
  privateUnifiedReviewStatus,
  unifiedReviewStatus,
} from "../dashboard/unified-review-dashboard.ts";

const NOW = Date.parse("2026-09-12T15:00:00Z");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function feed(tenant: "saari" | "dinkuskit", overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "clawsweeper.telemetry.v1",
    tenant,
    generated_at: "2026-09-12T14:59:30Z",
    stale_after_seconds: 300,
    lane: {
      app_installation: `${tenant}-clawsweeper`,
      queue_namespace: `${tenant}/reviews`,
      state_store: `${tenant}/clawsweeper-state@state`,
      mutation_authority: `${tenant} review workflow`,
    },
    rows: [
      {
        repository: tenant === "saari" ? "saari-co/x-api" : "dinkuskit/blocks",
        pr_number: 44,
        base_sha: SHA_A,
        head_sha: SHA_B,
        ci: "completed",
        ci_conclusion: "success",
        openclaw: tenant === "saari" ? "clean" : undefined,
        clawsweeper: "success",
        rating: "B Platinum Hermit",
        proof_links: [
          `https://github.com/${tenant === "saari" ? "saari-co/x-api" : "dinkuskit/blocks"}/actions/runs/1`,
          "https://github.com/private/proof/actions/runs/2",
          "javascript:alert(1)",
        ],
        engine_sha: tenant === "dinkuskit" ? "80cdeb241ab529008b1082749584be28a318e9ca" : SHA_A,
        executor: tenant === "saari" ? "spark-2/codex" : "github-actions/codex",
        findings_total: 4,
        findings_actionable: 1,
        observed_at: "2026-09-12T14:59:20Z",
        source: tenant === "saari" ? "spark-2 target workflow" : "caller workflow + state branch",
        github_token: "ghs_must_never_escape",
      },
    ],
    ...overrides,
  };
}

function base64url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}

async function accessFixture(claimOverrides: Record<string, unknown> = {}) {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const kid = "fixture-key";
  const header = base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: "https://fixture.cloudflareaccess.com",
      aud: ["fixture-audience"],
      sub: "fixture-user",
      email: "fixture@example.test",
      iat: Math.floor(NOW / 1000) - 30,
      exp: Math.floor(NOW / 1000) + 300,
      ...claimOverrides,
    }),
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    token: `${header}.${claims}.${base64url(new Uint8Array(signature))}`,
    env: {
      PRIVATE_OBSERVER_ACCESS_TEAM_DOMAIN: "fixture.cloudflareaccess.com",
      PRIVATE_OBSERVER_ACCESS_AUD: "fixture-audience",
      PRIVATE_OBSERVER_ACCESS_JWKS: {
        fetch: async () => Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }),
      },
    },
  };
}

test("publishes the official rank ladder", () => {
  assert.deepEqual(CLAWSWEEPER_RANKS, [
    "S Challenger Crab",
    "A Diamond Lobster",
    "B Platinum Hermit",
    "C Gold Shrimp",
    "D Silver Shellfish",
    "F Unranked Krab",
    "N/A Off-meta Tidepool",
  ]);
});

test("normalizes exact tuple telemetry and keeps absent OpenClaw state unknown", () => {
  const result = normalizeTenantFeed("dinkuskit", feed("dinkuskit"), NOW);
  assert.equal(result.projection.status, "available");
  assert.equal(result.rows[0]?.openclaw, "unknown");
  assert.equal(result.rows[0]?.engine_sha, "80cdeb241ab529008b1082749584be28a318e9ca");
  assert.deepEqual(result.rows[0]?.proof_links, [
    "https://github.com/dinkuskit/blocks/actions/runs/1",
    "https://github.com/private/proof/actions/runs/2",
  ]);
  assert.equal(result.rows[0]?.executor, "github-actions/codex");
  assert.equal(result.rows[0]?.findings_total, 4);
  assert.equal(result.rows[0]?.findings_actionable, 1);
});

test("does not infer success from a bare completed lifecycle state", () => {
  const value = feed("saari") as { rows: Array<Record<string, unknown>> };
  delete value.rows[0]!.ci_conclusion;
  const result = normalizeTenantFeed("saari", value, NOW);
  assert.equal(result.rows[0]?.ci, "unknown");
});

test("uses explicit terminal conclusions for completed lifecycle states", () => {
  const failed = feed("saari") as { rows: Array<Record<string, unknown>> };
  failed.rows[0]!.ci_conclusion = "failure";
  failed.rows[0]!.openclaw = "completed";
  failed.rows[0]!.openclaw_conclusion = "cancelled";
  failed.rows[0]!.clawsweeper = "completed";
  failed.rows[0]!.clawsweeper_conclusion = "success";

  const result = normalizeTenantFeed("saari", failed, NOW);
  assert.equal(result.rows[0]?.ci, "failure");
  assert.equal(result.rows[0]?.openclaw, "failure");
  assert.equal(result.rows[0]?.clawsweeper, "success");
});

test("keeps absent finding counts unknown", () => {
  const value = feed("saari") as { rows: Array<Record<string, unknown>> };
  delete value.rows[0]!.findings_total;
  value.rows[0]!.findings_actionable = null;
  const result = normalizeTenantFeed("saari", value, NOW);
  assert.equal(result.rows[0]?.findings_total, null);
  assert.equal(result.rows[0]?.findings_actionable, null);
});

test("marks stale telemetry explicitly", () => {
  const result = normalizeTenantFeed(
    "saari",
    feed("saari", { generated_at: "2026-09-12T13:00:00Z" }),
    NOW,
  );
  assert.equal(result.projection.status, "stale");
  assert.equal(result.projection.freshness, "stale");
});

test("keeps an unavailable tenant count null instead of zero", async () => {
  const response = await unifiedReviewStatus(
    new Request("https://example.test/api/reviews"),
    {
      UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES: "1",
      PUBLIC_BAY_REPOS: "saari-co/x-api",
      SAARI_REVIEW_FEED_JSON: JSON.stringify(feed("saari")),
    },
    NOW,
  );
  const body = (await response.json()) as {
    sources: Array<{ tenant: string; status: string; row_count: number | null }>;
    rows: unknown[];
  };
  assert.equal(body.rows.length, 1);
  assert.deepEqual(
    body.sources.find((source) => source.tenant === "dinkuskit"),
    {
      tenant: "dinkuskit",
      status: "unavailable",
      generated_at: null,
      freshness: "unknown",
      row_count: null,
      lane: null,
      error: "telemetry unavailable",
    },
  );
});

test("tenant views remain isolated", async () => {
  const env = {
    UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES: "1",
    PUBLIC_BAY_REPOS: "saari-co/x-api,dinkuskit/blocks",
    SAARI_REVIEW_FEED_JSON: JSON.stringify(feed("saari")),
    DINKUSKIT_REVIEW_FEED_JSON: JSON.stringify(feed("dinkuskit")),
  };
  const response = await unifiedReviewStatus(
    new Request("https://example.test/api/reviews?tenant=dinkuskit"),
    env,
    NOW,
  );
  const body = (await response.json()) as {
    sources: Array<{ tenant: string }>;
    rows: Array<{ tenant: string }>;
  };
  assert.deepEqual(
    body.sources.map((source) => source.tenant),
    ["dinkuskit"],
  );
  assert.deepEqual(
    body.rows.map((row) => row.tenant),
    ["dinkuskit"],
  );
});

test("worker exposes the review API and review page without mutation credentials", async () => {
  const env = {
    DASHBOARD_HOME: "private-reviews",
    UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES: "1",
    PUBLIC_BAY_REPOS: "saari-co/x-api,dinkuskit/blocks",
    SAARI_REVIEW_FEED_JSON: JSON.stringify(feed("saari")),
    DINKUSKIT_REVIEW_FEED_JSON: JSON.stringify(feed("dinkuskit")),
  };
  const api = await worker.fetch(new Request("https://clawsweeper.test/api/reviews"), env);
  const body = (await api.json()) as { rows: Array<{ tenant: string }> };
  assert.equal(api.status, 200);
  assert.deepEqual(
    body.rows.map((row) => row.tenant),
    ["saari", "dinkuskit"],
  );

  const page = await worker.fetch(new Request("https://clawsweeper.test/"), env);
  const html = await page.text();
  assert.match(html, /One read-only view\. Isolated tenant data planes\. Exact-head truth\./);
  assert.match(html, /data-tenant="dinkuskit"/);
  assert.doesNotMatch(html, /GITHUB_APP_PRIVATE_KEY/);
  assert.match(html, /\/api\/private\/reviews/);

  const publicPage = await worker.fetch(new Request("https://clawsweeper.test/reviews"), env);
  const publicHtml = await publicPage.text();
  assert.match(publicHtml, /fetch\('\/api\/reviews\?tenant='/);
  assert.doesNotMatch(publicHtml, /fetch\('\/api\/private\/reviews\?tenant='/);
});

test("fails an entire source closed when any row identity is malformed", () => {
  const result = normalizeTenantFeed(
    "saari",
    feed("saari", { rows: [{ repository: "invalid", pr_number: 0, source: "fixture" }] }),
    NOW,
  );
  assert.equal(result.projection.status, "invalid");
  assert.equal(result.projection.row_count, null);
  assert.deepEqual(result.rows, []);
});

test("rejects future-dated source and observation timestamps", () => {
  const future = new Date(NOW + 120_000).toISOString();
  const generated = normalizeTenantFeed("saari", feed("saari", { generated_at: future }), NOW);
  assert.equal(generated.projection.status, "invalid");

  const observedFeed = feed("saari") as { rows: Array<Record<string, unknown>> };
  observedFeed.rows[0]!.observed_at = future;
  const observed = normalizeTenantFeed("saari", observedFeed, NOW);
  assert.equal(observed.projection.status, "invalid");
  assert.equal(observed.projection.row_count, null);
});

test("a tenant-specific request neither fetches nor waits for the other tenant", async () => {
  let saariCalls = 0;
  const response = await unifiedReviewStatus(
    new Request("https://example.test/api/reviews?tenant=dinkuskit"),
    {
      SAARI_REVIEW_TELEMETRY: {
        fetch: () => {
          saariCalls += 1;
          return new Promise<Response>(() => undefined);
        },
      },
      DINKUSKIT_REVIEW_TELEMETRY: {
        fetch: async () => Response.json(feed("dinkuskit")),
      },
      PUBLIC_BAY_REPOS: "dinkuskit/blocks",
    },
    NOW,
    20,
  );
  const body = (await response.json()) as {
    sources: Array<{ tenant: string }>;
    rows: Array<{ tenant: string }>;
  };
  assert.equal(saariCalls, 0);
  assert.deepEqual(
    body.sources.map((source) => source.tenant),
    ["dinkuskit"],
  );
  assert.deepEqual(
    body.rows.map((row) => row.tenant),
    ["dinkuskit"],
  );
});

test("a stalled selected feeder becomes explicitly unavailable at its deadline", async () => {
  const response = await unifiedReviewStatus(
    new Request("https://example.test/api/reviews?tenant=saari"),
    {
      SAARI_REVIEW_TELEMETRY: {
        fetch: () => new Promise<Response>(() => undefined),
      },
    },
    NOW,
    10,
  );
  const body = (await response.json()) as {
    sources: Array<{ status: string; row_count: number | null; error: string }>;
  };
  assert.deepEqual(body.sources[0], {
    tenant: "saari",
    status: "unavailable",
    generated_at: null,
    freshness: "unknown",
    row_count: null,
    lane: null,
    error: "telemetry unavailable",
  });
});

test("public API suppresses private repositories, lane details, and private proof links", async () => {
  const dinkuskit = feed("dinkuskit") as { rows: Array<Record<string, unknown>> };
  dinkuskit.rows[0]!.proof_links = [
    "https://github.com/dinkuskit/blocks/actions/runs/1",
    "https://user:password@github.com/dinkuskit/blocks/actions/runs/2",
    "https://github.com/dinkuskit/blocks/actions/runs/3?token=secret",
    "https://github.com/dinkuskit/blocks/blob/main/private.txt",
  ];
  const response = await unifiedReviewStatus(
    new Request("https://example.test/api/reviews"),
    {
      UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES: "1",
      PUBLIC_BAY_REPOS: "dinkuskit/blocks",
      SAARI_REVIEW_FEED_JSON: JSON.stringify(feed("saari")),
      DINKUSKIT_REVIEW_FEED_JSON: JSON.stringify(dinkuskit),
    },
    NOW,
  );
  const body = (await response.json()) as {
    visibility: string;
    sources: Array<{ tenant: string; lane: unknown; row_count: number | null }>;
    rows: Array<{ repository: string; proof_links: string[] }>;
  };
  assert.equal(body.visibility, "public");
  assert.deepEqual(
    body.rows.map((row) => row.repository),
    ["dinkuskit/blocks"],
  );
  assert.deepEqual(body.rows[0]?.proof_links, [
    "https://github.com/dinkuskit/blocks/actions/runs/1",
  ]);
  assert.ok(body.sources.every((source) => source.lane === null));
  assert.equal(body.sources.find((source) => source.tenant === "saari")?.row_count, 0);
  assert.doesNotMatch(JSON.stringify(body), /ghs_must_never_escape|private\/proof|saari-co\/x-api/);
  assert.doesNotMatch(JSON.stringify(body), /password|token=secret|private\.txt/);
});

test("private observer rejects missing or invalid Access assertions before reading feeds", async () => {
  let feedCalls = 0;
  const env = {
    PRIVATE_OBSERVER_ACCESS_TEAM_DOMAIN: "fixture.cloudflareaccess.com",
    PRIVATE_OBSERVER_ACCESS_AUD: "fixture-audience",
    SAARI_REVIEW_TELEMETRY: {
      fetch: async () => {
        feedCalls += 1;
        return Response.json(feed("saari"));
      },
    },
  };
  const missing = await privateUnifiedReviewStatus(
    new Request("https://example.test/api/private/reviews?tenant=saari"),
    env,
    NOW,
  );
  const invalid = await privateUnifiedReviewStatus(
    new Request("https://example.test/api/private/reviews?tenant=saari", {
      headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" },
    }),
    env,
    NOW,
  );
  assert.deepEqual([missing.status, invalid.status, feedCalls], [401, 401, 0]);
  assert.deepEqual(await missing.json(), { error: "unauthorized" });
});

test("valid Access assertion exposes private rows without serializing credentials", async () => {
  const access = await accessFixture();
  const request = new Request("https://example.test/api/private/reviews?tenant=saari", {
    headers: { "Cf-Access-Jwt-Assertion": access.token },
  });
  assert.equal(await authorizePrivateObserver(request, access.env, NOW), true);
  const response = await privateUnifiedReviewStatus(
    request,
    {
      ...access.env,
      UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES: "1",
      SAARI_REVIEW_FEED_JSON: JSON.stringify({
        ...feed("saari"),
        github_app_private_key: "private-key-must-never-escape",
      }),
      DINKUSKIT_REVIEW_FEED_JSON: JSON.stringify(feed("dinkuskit")),
    },
    NOW,
  );
  const serialized = await response.text();
  const body = JSON.parse(serialized) as {
    visibility: string;
    sources: Array<{ tenant: string }>;
    rows: Array<{ repository: string; executor: string }>;
  };
  assert.equal(response.status, 200);
  assert.equal(body.visibility, "private");
  assert.deepEqual(
    body.sources.map((source) => source.tenant),
    ["saari"],
  );
  assert.deepEqual(
    body.rows.map((row) => row.repository),
    ["saari-co/x-api"],
  );
  assert.equal(body.rows[0]?.executor, "spark-2/codex");
  assert.doesNotMatch(serialized, /ghs_must_never_escape|private-key-must-never-escape|Cf-Access/);
});
