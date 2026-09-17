import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTenantFeed } from "../dashboard/unified-review-dashboard.ts";
import {
  createTelemetryFeeder,
  MAX_TELEMETRY_ROWS,
  TELEMETRY_MAX_BODY_BYTES,
} from "../dashboard/telemetry-feeder/worker.ts";

const NOW = Date.parse("2026-09-13T18:00:00Z");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TOKEN = "ghs_secret_token_must_never_escape";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "clawsweeper.telemetry.v1",
    tenant: "saari",
    generated_at: "2026-09-13T17:59:30Z",
    stale_after_seconds: 900,
    lane: {
      app_installation: "saari-clawsweeper (App ID 4070026)",
      queue_namespace: "spark-2:openclaw-review",
      state_store: "saari-co/clawsweeper-state@state",
      mutation_authority: "saari-co/spark-dgx clawsweeper-review lane",
    },
    rows: [
      {
        repository: "saari-co/x-api",
        pr_number: 44,
        base_sha: SHA_A,
        head_sha: SHA_B,
        ci: "completed",
        ci_conclusion: "success",
        openclaw: "completed",
        openclaw_conclusion: "success",
        clawsweeper: "completed",
        clawsweeper_conclusion: "success",
        rating: "B Platinum Hermit",
        proof_links: ["https://github.com/saari-co/x-api/pull/44"],
        engine_sha: SHA_A,
        executor: "spark-2",
        findings_total: 0,
        findings_actionable: 0,
        observed_at: "2026-09-13T17:59:20Z",
        source: "spark-2 openclaw-review + clawsweeper-review",
      },
    ],
    ...overrides,
  };
}

function env(overrides: Record<string, string> = {}) {
  return {
    TENANT: "saari",
    TELEMETRY_SOURCE_REPO: "saari-co/clawsweeper-state",
    TELEMETRY_SOURCE_REF: "state",
    TELEMETRY_SOURCE_PATH: "results/review-telemetry/saari.json",
    TELEMETRY_SOURCE_TOKEN: TOKEN,
    STALE_AFTER_SECONDS: "900",
    ...overrides,
  };
}

function contentsResponse(document: unknown, init: ResponseInit = {}) {
  return new Response(
    JSON.stringify({
      encoding: "base64",
      content: Buffer.from(JSON.stringify(document), "utf8").toString("base64"),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    },
  );
}

function statusRequest(path = "/v1/reviews/status") {
  return new Request(`https://telemetry.internal${path}`);
}

async function read(response: Response) {
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

function assertNoSecret(text: string) {
  assert.doesNotMatch(text, new RegExp(TOKEN, "i"));
  assert.doesNotMatch(text, /authorization/i);
  assert.doesNotMatch(text, /Bearer /);
}

test("valid envelope is sanitized and passed through", async () => {
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(
      String(input),
      /saari-co\/clawsweeper-state\/contents\/results\/review-telemetry\/saari\.json/,
    );
    assert.match(String(input), /ref=state/);
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.authorization, `Bearer ${TOKEN}`);
    return contentsResponse(envelope());
  };
  const feeder = createTelemetryFeeder({ fetch: fetchImpl, now: () => NOW });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 200);
  assert.equal(result.body.schema_version, "clawsweeper.telemetry.v1");
  assert.equal(result.body.tenant, "saari");
  assert.equal(
    (result.body.rows as Array<Record<string, unknown>>)[0]?.openclaw_conclusion,
    "success",
  );
  assert.equal((await feeder(statusRequest(), env())).headers.get("cache-control"), "no-store");
  assertNoSecret(result.text);
});

test("tenant mismatch returns 503 unavailable", async () => {
  const feeder = createTelemetryFeeder({
    fetch: async () => contentsResponse(envelope({ tenant: "dinkuskit" })),
    now: () => NOW,
  });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, {
    schema_version: "clawsweeper.telemetry.v1",
    tenant: "saari",
    status: "unavailable",
    reason: "tenant mismatch",
  });
  assert.equal(Array.isArray(result.body.rows), false);
  assertNoSecret(result.text);
});

test("malformed JSON returns 503 unavailable", async () => {
  const feeder = createTelemetryFeeder({
    fetch: async () =>
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    now: () => NOW,
  });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 503);
  assert.equal(result.body.status, "unavailable");
  assert.equal(result.body.reason, "malformed telemetry");
  assertNoSecret(result.text);
});

test("non-200 source returns 503 without echoing the upstream body", async () => {
  const feeder = createTelemetryFeeder({
    fetch: async () =>
      new Response(`denied for ${TOKEN}`, {
        status: 403,
        headers: { "content-type": "text/plain" },
      }),
    now: () => NOW,
  });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 503);
  assert.equal(result.body.status, "unavailable");
  assert.equal(result.body.reason, "source unavailable");
  assertNoSecret(result.text);
});

test("oversized source returns 503", async () => {
  const feeder = createTelemetryFeeder({
    fetch: async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(TELEMETRY_MAX_BODY_BYTES + 1) },
      }),
    now: () => NOW,
  });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 503);
  assert.equal(result.body.reason, "telemetry oversized");
  assertNoSecret(result.text);
});

test("timeout returns 503", async () => {
  const feeder = createTelemetryFeeder({
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    now: () => NOW,
    timeoutMs: 10,
  });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 503);
  assert.equal(result.body.reason, "telemetry timeout");
  assertNoSecret(result.text);
});

test("source token never appears in any response body", async () => {
  const cases = [
    createTelemetryFeeder({
      fetch: async () => contentsResponse(envelope({ github_token: TOKEN })),
      now: () => NOW,
    }),
    createTelemetryFeeder({
      fetch: async () => new Response(`{"error":"${TOKEN}"}`, { status: 500 }),
      now: () => NOW,
    }),
  ];
  for (const feeder of cases) {
    const result = await read(await feeder(statusRequest(), env()));
    assertNoSecret(result.text);
  }
});

test("other paths return 404", async () => {
  const feeder = createTelemetryFeeder({
    fetch: async () => {
      throw new Error("fetch must not run for unknown paths");
    },
    now: () => NOW,
  });
  const missing = await read(await feeder(statusRequest("/v1/reviews/other"), env()));
  const posted = await read(
    await feeder(
      new Request("https://telemetry.internal/v1/reviews/status", { method: "POST" }),
      env(),
    ),
  );
  assert.equal(missing.status, 404);
  assert.equal(posted.status, 404);
  assertNoSecret(missing.text);
  assertNoSecret(posted.text);
});

test("consumer normalizeTenantFeed accepts the feeder passthrough", async () => {
  const feeder = createTelemetryFeeder({
    fetch: async () => contentsResponse(envelope()),
    now: () => NOW,
  });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 200);
  const normalized = normalizeTenantFeed("saari", result.body, NOW);
  assert.equal(normalized.projection.status, "available");
  assert.equal(normalized.rows[0]?.repository, "saari-co/x-api");
  assert.equal(normalized.rows[0]?.ci, "success");
  assert.equal(normalized.rows[0]?.openclaw, "success");
  assert.equal(normalized.rows[0]?.clawsweeper, "success");
  assert.equal(normalized.rows[0]?.rating, "B Platinum Hermit");
});

test("rows are capped at the consumer MAX_ROWS", async () => {
  const rows = Array.from({ length: MAX_TELEMETRY_ROWS + 3 }, (_, index) => ({
    repository: "saari-co/x-api",
    pr_number: index + 1,
    base_sha: SHA_A,
    head_sha: SHA_B,
    ci: "unknown",
    openclaw: "unknown",
    clawsweeper: "unknown",
    rating: null,
    proof_links: [],
    engine_sha: SHA_A,
    executor: "spark-2",
    findings_total: null,
    findings_actionable: null,
    observed_at: "2026-09-13T17:59:20Z",
    source: "spark-2 fixture",
  }));
  const feeder = createTelemetryFeeder({
    fetch: async () => contentsResponse(envelope({ rows })),
    now: () => NOW,
  });
  const result = await read(await feeder(statusRequest(), env()));
  assert.equal(result.status, 200);
  assert.equal((result.body.rows as unknown[]).length, MAX_TELEMETRY_ROWS);
  const normalized = normalizeTenantFeed("saari", result.body, NOW);
  assert.equal(normalized.projection.status, "available");
  assert.equal(normalized.projection.row_count, MAX_TELEMETRY_ROWS);
});
