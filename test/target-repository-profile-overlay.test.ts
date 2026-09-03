import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  readTargetRepositoryConfigSource,
  TARGET_REPOSITORY_PROFILE_OVERLAY_ENV,
  targetRepositoryProfileOverlayPath,
} from "../dist/target-repository-config.js";
import {
  __resetTargetRepoToolchainCache,
  resolveTargetRepoToolchain,
} from "../dist/repair/target-toolchain-config.js";

const bundledPath = join(process.cwd(), "config", "target-repositories.json");

function overlayFixture() {
  return {
    schema_version: 2,
    repositories: [
      {
        target_repo: "saari-co/special",
        display_name: "Special",
        checkout_dir: "special",
        package_manager: "npm",
        validation_commands: ["npm test"],
        changed_gate: null,
        prompt_note: "Review the special repository conservatively.",
        apply_close_rules: { issue: [], pull_request: [] },
      },
    ],
    generic_fallbacks: [
      {
        owner: "saari-co",
        deny_repositories: [],
        allow_repo_name_pattern: "^[A-Za-z0-9_.-]+$",
        package_manager: "pnpm",
        validation_commands: [],
        changed_gate: null,
        prompt_note: "Review {target_repo} conservatively.",
        apply_close_rules: { issue: [], pull_request: [] },
      },
    ],
  };
}

test("profile overlay extends runtime profiles and toolchains without changing bundled policy", () => {
  const root = mkdtempSync(join(tmpdir(), "clawsweeper-profile-overlay-"));
  const overlayPath = join(root, "profiles.json");
  writeFileSync(overlayPath, `${JSON.stringify(overlayFixture(), null, 2)}\n`);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          const { repositoryProfileFor } = await import("./dist/repository-profiles.js");
          const { resolveTargetRepoToolchain } = await import("./dist/repair/target-toolchain-config.js");
          const { readInventoryConfig } = await import("./dist/repair/target-fanout.js");
          const fallback = repositoryProfileFor("Saari-Co/example");
          const explicit = repositoryProfileFor("saari-co/special");
          const bundled = repositoryProfileFor("openclaw/openclaw");
          console.log(JSON.stringify({
            fallback: {
              targetRepo: fallback.targetRepo,
              promptNote: fallback.promptNote,
              applyCloseRules: fallback.applyCloseRules,
              toolchain: resolveTargetRepoToolchain(fallback.targetRepo),
            },
            explicit: {
              targetRepo: explicit.targetRepo,
              packageManager: explicit.packageManager,
              toolchain: resolveTargetRepoToolchain(explicit.targetRepo),
            },
            bundled: {
              targetRepo: bundled.targetRepo,
              issueCanClose: bundled.applyCloseRules.issue?.includes("implemented_on_main"),
            },
            inventoryOwners: readInventoryConfig().owners,
          }));
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, [TARGET_REPOSITORY_PROFILE_OVERLAY_ENV]: overlayPath },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      fallback: Record<string, unknown>;
      explicit: Record<string, unknown>;
      bundled: Record<string, unknown>;
      inventoryOwners: string[];
    };
    assert.deepEqual(output.fallback, {
      targetRepo: "saari-co/example",
      promptNote: "Review saari-co/example conservatively.",
      applyCloseRules: { issue: [], pull_request: [] },
      toolchain: { packageManager: "pnpm", baseValidationCommands: [], changedGate: null },
    });
    assert.deepEqual(output.explicit, {
      targetRepo: "saari-co/special",
      packageManager: "npm",
      toolchain: {
        packageManager: "npm",
        baseValidationCommands: ["npm test"],
        changedGate: null,
      },
    });
    assert.deepEqual(output.bundled, {
      targetRepo: "openclaw/openclaw",
      issueCanClose: true,
    });
    assert.ok(!output.inventoryOwners.includes("saari-co"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile overlay cannot replace bundled repository or owner policy", () => {
  const root = mkdtempSync(join(tmpdir(), "clawsweeper-profile-collision-"));
  const bundled = JSON.parse(readFileSync(bundledPath, "utf8")) as Record<string, unknown>;

  try {
    for (const [index, overlay] of [
      {
        schema_version: bundled.schema_version,
        repositories: [{ target_repo: "OpenClaw/ClawHub" }],
      },
      { schema_version: bundled.schema_version, generic_fallbacks: [{ owner: "OPENCLAW" }] },
    ].entries()) {
      const overlayPath = join(root, `profiles-${index}.json`);
      writeFileSync(overlayPath, `${JSON.stringify(overlay)}\n`);
      assert.throws(
        () =>
          readTargetRepositoryConfigSource(bundledPath, {
            [TARGET_REPOSITORY_PROFILE_OVERLAY_ENV]: overlayPath,
          }),
        /cannot replace bundled/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile overlay path must be absolute and its schema surface stays narrow", () => {
  assert.throws(
    () =>
      targetRepositoryProfileOverlayPath({
        [TARGET_REPOSITORY_PROFILE_OVERLAY_ENV]: "relative/profiles.json",
      }),
    /must be an absolute path/,
  );

  const root = mkdtempSync(join(tmpdir(), "clawsweeper-profile-surface-"));
  const overlayPath = join(root, "profiles.json");
  writeFileSync(
    overlayPath,
    `${JSON.stringify({ ...overlayFixture(), target_inventory: { owners: ["saari-co"] } })}\n`,
  );
  try {
    assert.throws(
      () =>
        readTargetRepositoryConfigSource(bundledPath, {
          [TARGET_REPOSITORY_PROFILE_OVERLAY_ENV]: overlayPath,
        }),
      /unsupported keys: target_inventory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repair toolchain lookup keeps its total-function fallback for an invalid overlay path", () => {
  const previous = process.env[TARGET_REPOSITORY_PROFILE_OVERLAY_ENV];
  process.env[TARGET_REPOSITORY_PROFILE_OVERLAY_ENV] = "relative/profiles.json";
  __resetTargetRepoToolchainCache();
  try {
    assert.deepEqual(resolveTargetRepoToolchain("saari-co/example"), {
      packageManager: "pnpm",
      baseValidationCommands: [],
      changedGate: null,
    });
  } finally {
    if (previous === undefined) delete process.env[TARGET_REPOSITORY_PROFILE_OVERLAY_ENV];
    else process.env[TARGET_REPOSITORY_PROFILE_OVERLAY_ENV] = previous;
    __resetTargetRepoToolchainCache();
  }
});
