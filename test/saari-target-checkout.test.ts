import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("exact-tuple checkout authenticates private Git reads without persistent auth or lazy blobs", async () => {
  const root = mkdtempSync(join(tmpdir(), "exact-tuple-private-git-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/usr/bin/false",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    git("init", "-b", "main", "source");
    writeFileSync(join(root, "source", "file.txt"), "base\n");
    git("-C", "source", "add", ".");
    git("-C", "source", "commit", "-m", "base");
    const base = git("-C", "source", "rev-parse", "HEAD");
    git("clone", "--bare", "source", "repo.git");
    writeFileSync(join(root, "source", "file.txt"), "review head\n");
    git("-C", "source", "commit", "-am", "head");
    const head = git("-C", "source", "rev-parse", "HEAD");
    git("-C", "source", "push", "../repo.git", "HEAD:refs/pull/7/head");
    git("--git-dir=repo.git", "update-server-info");

    // Synthetic loopback-only authentication; no real account or credential.
    const fixturePassword = "synthetic-fixture-only";
    const authorization = `Basic ${Buffer.from(`fixture:${fixturePassword}`).toString("base64")}`;
    server = createServer((request, response) => {
      if (request.headers.authorization !== authorization) {
        response.writeHead(401, { "www-authenticate": 'Basic realm="fixture"' }).end();
        return;
      }
      const path = resolve(root, `.${new URL(request.url!, "http://localhost").pathname}`);
      if (!path.startsWith(join(root, "repo.git") + "/")) {
        response.writeHead(403).end();
        return;
      }
      try {
        response.end(readFileSync(path));
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    mkdirSync(join(root, "bin"));
    const helper = join(root, "bin", "gh");
    writeFileSync(
      helper,
      `#!/bin/sh\n[ "$1 $2 $3" = "auth git-credential get" ] || exit 0\nprintf 'username=fixture\\npassword=${fixturePassword}\\n\\n'\n`,
    );
    chmodSync(helper, 0o755);
    const workflow = readFileSync(
      new URL("../.github/workflows/saari-exact-tuple-review.yml", import.meta.url),
      "utf8",
    );
    const step = workflow
      .split("      - name: Prepare the exact target checkout as read-only data\n")[1]
      .split("\n      - name:")[0];
    const script = step
      .split("        run: |\n")[1]
      .replace(/^ {10}/gm, "")
      .replace(
        '"https://github.com/$TARGET_REPO.git"',
        `"http://127.0.0.1:${address.port}/repo.git"`,
      );
    const target = join(root, "target");
    const jobEnv = {
      ...env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      PRODUCER_TARGET: target,
      PRODUCER_RUN_ROOT: join(root, "run"),
      PRODUCER_CHECKOUT: join(root, "source"),
      TARGET_REPO: "fixture/private-repo",
      BASE_REF: "main",
      BASE_SHA: base,
      HEAD_SHA: head,
      MERGE_BASE_SHA: base,
      PR_NUMBER: "7",
    };
    await assert.rejects(
      run(
        "bash",
        ["-c", script.replace("credential.helper=!gh auth git-credential", "credential.helper=")],
        { env: jobEnv },
      ),
      /terminal prompts disabled/,
    );
    await run("bash", ["-c", script], { env: jobEnv });
    assert.equal(git("-C", target, "rev-parse", "HEAD"), head);
    assert.equal(git("-C", target, "show", `${base}:file.txt`), "base");
    assert.equal(readFileSync(join(target, "file.txt"), "utf8"), "review head\n");
    const config = readFileSync(join(target, ".git", "config"), "utf8");
    assert.doesNotMatch(config, /credential|promisor|partialclonefilter|synthetic-fixture-only/i);
    assert.equal(git("-C", target, "status", "--porcelain"), "");
  } finally {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  }
});
