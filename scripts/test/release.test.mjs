import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readReleaseInfo, releaseInfo } from "../release-info.mjs";

test("release metadata has canonical filenames and an exact version tag", () => {
  assert.deepEqual(releaseInfo("0.2.3-0015", "0.2.3", "refs/heads/main"), {
    version: "0.2.3-0015", tag: "v0.2.3-0015", file: "DSM-Terminal-0.2.3-0015-apollolake.spk"
  });
  assert.equal(releaseInfo("0.2.3-0015", "0.2.3", "refs/tags/v0.2.3-0015").tag, "v0.2.3-0015");
});

test("release metadata rejects mismatched tags, app versions and shell/path injection", () => {
  assert.throws(() => releaseInfo("0.2.3-0015", "0.2.3", "refs/tags/v0.2.3-0016"));
  assert.throws(() => releaseInfo("0.2.3-0015", "0.2.4"));
  for (const version of ["0.2.3", "../0.2.3-0015", "0.2.3-0015\n", "0.2.3-0015\nx=y", "0.2.3-0015;echo bad", "0.2.3-0015-private"]) {
    assert.throws(() => releaseInfo(version, "0.2.3"));
  }
});

test("release archive checks reject private origins, data, checksums, names and version mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-release-test-"));
  const info = await readReleaseInfo("");
  const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32/tar.exe") : "tar";
  const payload = join(root, "payload");
  const outer = join(root, "outer");
  const archive = join(root, info.file);
  const checker = fileURLToPath(new URL("../check-release.mjs", import.meta.url));
  const childEnv = { ...process.env, GITHUB_REF: "refs/heads/main" };
  delete childEnv.DSM_TERMINAL_PRIVACY_RULES;
  const check = (path = archive) => spawnSync(process.execPath, [checker, path], { env: childEnv, encoding: "utf8" });
  const pack = async (version = info.version) => {
    await writeFile(join(outer, "INFO"), `version="${version}"\n`);
    execFileSync(tar, ["-czf", join(outer, "package.tgz"), "-C", payload, "."]);
    execFileSync(tar, ["-cf", archive, "-C", outer, "INFO", "package.tgz"]);
    const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
    await writeFile(`${archive}.sha256`, `${digest}  ${info.file}\n`);
  };
  try {
    await mkdir(join(payload, "config"), { recursive: true });
    await mkdir(outer);
    await writeFile(join(payload, "LICENSE"), "MIT License\n");
    const config = join(payload, "config/access.json");
    await writeFile(config, JSON.stringify({ externalUrl: "https://nas.example.com" }));
    await pack();
    const valid = check();
    assert.equal(valid.status, 0, valid.stderr);
    await writeFile(`${archive}.sha256`, (await readFile(`${archive}.sha256`, "utf8")).replace("  ", " *"));
    assert.equal(check().status, 0, "GNU binary-mode checksum must also be accepted");
    const wrongName = join(root, "private.spk");
    await copyFile(archive, wrongName);
    assert.notEqual(check(wrongName).status, 0);
    await writeFile(`${archive}.sha256`, "invalid\n");
    assert.notEqual(check().status, 0);
    await writeFile(config, JSON.stringify({ externalUrl: "https://custom.example.invalid" }));
    await pack();
    assert.notEqual(check().status, 0);
    await writeFile(config, JSON.stringify({ externalUrl: "https://nas.example.com" }));
    await writeFile(join(payload, "credentials.key"), "test-only-data");
    await pack();
    assert.notEqual(check().status, 0);
    await rm(join(payload, "credentials.key"));
    await pack("0.0.0-0000");
    assert.notEqual(check().status, 0);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
