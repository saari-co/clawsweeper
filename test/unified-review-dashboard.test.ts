import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dashboard/worker.ts";
import {
  CLAWSWEEPER_RANKS,
  normalizeTenantFeed,
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
        openclaw: tenant === "saari" ? "clean" : undefined,
        clawsweeper: "success",
        rating: "B Platinum Hermit",
        proof_links: ["https://github.com/example/proof", "javascript:alert(1)"],
        engine_sha: tenant === "dinkuskit" ? "80cdeb241ab529008b1082749584be28a318e9ca" : SHA_A,
        observed_at: "2026-09-12T14:59:20Z",
        source: tenant === "saari" ? "spark-2 target workflow" : "caller workflow + state branch",
      },
    ],
    ...overrides,
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
  assert.deepEqual(result.rows[0]?.proof_links, ["https://github.com/example/proof"]);
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
      error: "DINKUSKIT_REVIEW_TELEMETRY is unavailable",
    },
  );
});

test("tenant views remain isolated", async () => {
  const env = {
    UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES: "1",
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
    DASHBOARD_HOME: "reviews",
    UNIFIED_DASHBOARD_ALLOW_INLINE_FIXTURES: "1",
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
});
