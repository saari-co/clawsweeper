import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadConsumerPin,
  parseProveArgs,
  resolveConsumerCheckout,
  verifyPinnedConsumerFiles,
} from "../scripts/prove-saari-exact-tuple-consumer.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROVE = join(REPO_ROOT, "scripts", "prove-saari-exact-tuple-consumer.mjs");
const PIN_PATH = join(REPO_ROOT, "config", "saari-exact-tuple-consumer-pin.json");
const EXTRACTION_PATH = join(REPO_ROOT, "config", "saari-exact-tuple-extraction.json");

function runProve(args: string[]) {
  try {
    return {
      ok: true,
      stdout: execFileSync(process.execPath, [PROVE, ...args], {
        encoding: "utf8",
        cwd: REPO_ROOT,
      }),
      stderr: "",
    };
  } catch (error) {
    const err = error && typeof error === "object" ? error : { message: String(error) };
    return {
      ok: false,
      stdout: "stdout" in err ? String(err.stdout ?? "") : "",
      stderr: "stderr" in err ? String(err.stderr ?? "") : String(error),
    };
  }
}

test("consumer pin records hashes without vendoring parse_clawsweeper_bundle", () => {
  const pin = loadConsumerPin(REPO_ROOT);
  assert.equal(pin.source_commit, "f42875beeeab4cc1e82b701a692ff38ec8ac4a64");
  assert.equal(pin.function, "parse_clawsweeper_bundle");
  assert.equal(
    Object.keys(pin.files).sort().join(","),
    [
      "tools/review_conductor.py",
      "tools/review_conductor_profiles.py",
      "tools/review_conductor_runtime.py",
      "tools/review_conductor_userland.py",
    ]
      .sort()
      .join(","),
  );

  const extraction = JSON.parse(readFileSync(EXTRACTION_PATH, "utf8"));
  assert.equal(extraction.consumer_pin.commit, pin.source_commit);
  assert.equal(extraction.consumer_pin.sha256, pin.files[pin.entry].sha256);
  assert.equal(extraction.consumer_pin.pin_path, "config/saari-exact-tuple-consumer-pin.json");
  assert.equal(extraction.consumer_pin.destination_path, undefined);

  const vendorRoot = join(
    REPO_ROOT,
    "test",
    "fixtures",
    "review-conductor-f42875beeeab4cc1e82b701a692ff38ec8ac4a64",
  );
  assert.equal(runProve([]).ok, false);
  for (const rel of Object.keys(pin.files)) {
    assert.throws(() => readFileSync(join(vendorRoot, rel)), /ENOENT/);
  }
});

test("standard consumer proof command fails closed without a supplied checkout", () => {
  assert.throws(() => resolveConsumerCheckout(parseProveArgs([])), /cannot be skipped/);
  assert.throws(
    () => resolveConsumerCheckout(parseProveArgs(["--consumer-checkout", REPO_ROOT])),
    /independent supplied tree/,
  );

  const missing = runProve([]);
  assert.equal(missing.ok, false);
  assert.match(missing.stderr, /cannot be skipped/);

  const separatorOnly = runProve(["--"]);
  assert.equal(separatorOnly.ok, false);
  assert.match(separatorOnly.stderr, /cannot be skipped/);

  const insideRepo = runProve(["--consumer-checkout", join(REPO_ROOT, "config")]);
  assert.equal(insideRepo.ok, false);
  assert.match(insideRepo.stderr, /independent supplied tree/);
});

test("supplied consumer checkout is hash-pinned before parse_clawsweeper_bundle runs", () => {
  const pin = loadConsumerPin(REPO_ROOT);
  const checkout = mkdtempSync(join(tmpdir(), "saari-consumer-pin-"));
  mkdirSync(join(checkout, "tools"));
  for (const rel of Object.keys(pin.files)) {
    writeFileSync(join(checkout, rel), "not the pinned consumer\n");
  }
  assert.throws(() => verifyPinnedConsumerFiles(checkout, pin), /hash mismatch/);

  const mismatched = runProve(["--consumer-checkout", checkout]);
  assert.equal(mismatched.ok, false);
  assert.match(mismatched.stderr, /hash mismatch/);
  assert.doesNotMatch(mismatched.stderr, /cannot be skipped/);
});

test("producer sources do not hard-code a machine-local Conductor checkout", () => {
  const pin = readFileSync(PIN_PATH, "utf8");
  const prove = readFileSync(PROVE, "utf8");
  const testSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  for (const source of [pin, prove, testSource]) {
    assert.doesNotMatch(source, /\/Users\//);
    assert.doesNotMatch(source, /conductor-source\/tools/);
  }
});
