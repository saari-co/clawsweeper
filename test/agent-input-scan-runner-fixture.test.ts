import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  classifyReviewedFixtureScan,
  type ReviewedAttribution,
  type StagedScanInput,
} from "../dist/agent-input-scan-fixtures.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const source = "runner/unit/request-policy.test.mjs";
const uri = "https://runner-synthetic:fixture-synthetic@fixture.invalid/";
const raw = uri.slice(0, -1);
const line = `const rejected = "${uri}";`;
const body = line + "\n";

function fixture() {
  const file = "/scanner/blob";
  const inputs = new Map<string, StagedScanInput>([
    [
      file,
      {
        kind: "blob",
        id: "1".repeat(40),
        bytes: Buffer.from(body),
        references: [{ source, mode: "100644", revision: "2".repeat(40), role: "base" }],
      },
    ],
  ]);
  const policy: ReviewedAttribution[] = [
    [17, "URI", "PLAIN", hash(raw), hash(uri), hash(line), source, "100644", [hash(body)]],
  ];
  const finding = {
    SourceType: 15,
    DetectorType: 17,
    DetectorName: "URI",
    DecoderName: "PLAIN",
    Verified: false,
    VerificationError: "synthetic fixture verification failed",
    Raw: raw,
    RawV2: uri,
    SecretParts: {
      host: "fixture.invalid",
      username: "runner-synthetic",
      password: "fixture-synthetic",
    },
    ExtraData: null,
    StructuredData: null,
    SourceMetadata: { Data: { Filesystem: { file, line: 1 } } },
  };
  const scan = (rows: unknown[] = [finding], policies = policy) =>
    classifyReviewedFixtureScan(
      183,
      Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"),
      Buffer.from(
        JSON.stringify({
          level: "info-0",
          logger: "trufflehog",
          msg: "finished scanning",
          trufflehog_version: "3.97.4",
          chunks: 1,
          bytes: 1,
          verified_secrets: rows.filter((r) => (r as typeof finding).Verified).length,
          unverified_secrets: rows.filter((r) => !(r as typeof finding).Verified).length,
        }) + "\n",
      ),
      inputs,
      policies,
    );
  return { inputs, policy, finding, scan, file };
}

test("runner rejection fixture requires its exact complete source blob", () => {
  const f = fixture();
  assert.equal(f.scan().kind, "classified");
  const blob = f.inputs.get(f.file)!;
  f.inputs.set(f.file, { ...blob, bytes: Buffer.from(body + "// unrelated append\n") });
  assert.equal(f.scan().kind, "refused");
});

test("runner rejection fixture cannot omit its whole-source binding", () => {
  const f = fixture();
  const missing = f.policy.map((row) => row.slice(0, 8) as unknown as ReviewedAttribution);
  assert.throws(() => f.scan([f.finding], missing), /reviewed attribution/i);
});

for (const [name, override] of Object.entries({
  verified: { Verified: true },
  decoder: { DecoderName: "HTML" },
  detector: { DetectorType: 938, DetectorName: "Privacy" },
  identity: { RawV2: uri.replace("fixture-synthetic", "other-synthetic") },
  parts: {
    SecretParts: { host: "fixture.invalid", username: "runner-synthetic", password: "other" },
  },
  structured: { StructuredData: {} },
})) {
  test(`runner rejection fixture rejects altered ${name}`, () => {
    const f = fixture();
    assert.equal(f.scan([{ ...f.finding, ...override }]).kind, "refused");
  });
}

test("runner rejection fixture rejects an unreviewed source path", () => {
  const f = fixture();
  const blob = f.inputs.get(f.file)!;
  assert.equal(blob.kind, "blob");
  if (blob.kind !== "blob") throw new Error("fixture");
  f.inputs.set(f.file, {
    ...blob,
    references: blob.references.map((r) => ({ ...r, source: "other.test.mjs" })),
  });
  assert.equal(f.scan().kind, "refused");
});

test("runner rejection fixture rejects a different full line even if its blob is listed", () => {
  const f = fixture();
  const changed = Buffer.from("// changed prefix " + body);
  f.inputs.set(f.file, { ...f.inputs.get(f.file)!, bytes: changed });
  const policy = f.policy.map(
    (row) => [...row.slice(0, 8), [hash(changed)]] as unknown as ReviewedAttribution,
  );
  assert.equal(f.scan([f.finding], policy).kind, "refused");
});

test("runner rejection fixture does not admit additional unknown findings", () => {
  const f = fixture();
  assert.equal(
    f.scan([f.finding, { ...f.finding, Raw: "unknown", RawV2: "unknown" }]).kind,
    "refused",
  );
});

for (const decoder of ["PLAIN", "HTML", "ESCAPED_UNICODE"] as const) {
  test(`runner rejection fixture admits explicitly registered ${decoder} patch witnesses`, () => {
    const f = fixture();
    f.inputs.clear();
    const before = Buffer.from(body);
    const after = Buffer.from(body + "// after\n");
    const oid = (b: Buffer) =>
      createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
    const base = "2".repeat(40);
    const head = "3".repeat(40);
    const a = oid(before);
    const b = oid(after);
    f.inputs.set(`/scanner/${a}`, {
      kind: "blob",
      id: a,
      bytes: before,
      references: [{ source, mode: "100644", revision: base, role: "base" }],
    });
    f.inputs.set(`/scanner/${b}`, {
      kind: "blob",
      id: b,
      bytes: after,
      references: [{ source, mode: "100644", revision: head, role: "head" }],
    });
    const patch = `diff --git a/${source} b/${source}\nindex ${a}..${b} 100644\n--- a/${source}\n+++ b/${source}\n@@ -1 +1,2 @@\n ${line}\n+// after\n`;
    f.inputs.set("/scanner/patch", {
      kind: "patch",
      id: "patch",
      from: base,
      to: head,
      bytes: Buffer.from(patch),
    });
    const fields: unknown[] = [...f.policy[0]!];
    fields[2] = decoder;
    fields[8] = [hash(before), hash(after)];
    const row = fields as unknown as ReviewedAttribution;
    const finding = {
      ...f.finding,
      DecoderName: decoder,
      SourceMetadata: { Data: { Filesystem: { file: "/scanner/patch", line: 6 } } },
    };
    assert.equal(f.scan([finding], [row]).kind, "classified");
  });
}
