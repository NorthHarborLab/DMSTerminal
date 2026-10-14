import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseInfo } from "./release-info.mjs";

const info = await readReleaseInfo();
const archive = resolve(process.argv[2] ?? fileURLToPath(new URL(`../release/${info.file}`, import.meta.url)));
assert.equal(basename(archive), info.file, "Only the canonical generic package filename may be released");
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
const checksum = await readFile(`${archive}.sha256`, "utf8");
assert.ok(checksum === `${digest}  ${info.file}\n` || checksum === `${digest} *${info.file}\n`, "Package checksum mismatch");
const rulesFile = process.env.DSM_TERMINAL_PRIVACY_RULES;
const forbidden = rulesFile ? JSON.parse(await readFile(rulesFile, "utf8")).forbidden : [];
assert.ok(Array.isArray(forbidden) && forbidden.every(value => typeof value === "string" && value.length), "Invalid privacy rules");
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{40,}\r?\n){2}|\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})\b/;
const privatePath = /(^|\/)(?:\.git|\.local|\.codegraph|data)(\/|$)|(^|\/)(?:credentials\.key|profiles\.json|\.env(?:\..*)?|\.modules\.yaml|\.pnpm-workspace-state-v1\.json)$|\.(?:log|tmp)$/i;
const directory = await mkdtemp(join(tmpdir(), "dsm-release-check-"));
const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32/tar.exe") : "tar";

function extract(path) {
  const entries = execFileSync(tar, ["-tf", path], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  assert.ok(entries.every(entry => !entry.includes("\\") && !entry.startsWith("/") && !entry.includes(":") && !entry.split("/").includes("..")), "Unsafe archive path");
  execFileSync(tar, ["-xf", path, "-C", directory]);
}

async function checkFiles(path, prefix = "") {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const label = `${prefix}${entry.name}`;
    assert.ok(!entry.isSymbolicLink(), "Release must not contain symbolic links");
    assert.ok(!privatePath.test(label), "Private runtime or build metadata found in release");
    assert.ok(!forbidden.some(pattern => label.toLowerCase().includes(pattern.toLowerCase())), "Private filename found in release");
    if (entry.isDirectory()) await checkFiles(join(path, entry.name), `${label}/`);
    else {
      const value = await readFile(join(path, entry.name), "utf8");
      assert.ok(!secret.test(value), `Possible credential material in release file: ${label}`);
      assert.ok(!forbidden.some(pattern => value.toLowerCase().includes(pattern.toLowerCase())), "Private content found in release");
    }
  }
}

try {
  extract(archive);
  assert.match(await readFile(join(directory, "INFO"), "utf8"), new RegExp(`^version="${info.version.replaceAll(".", "\\.")}"$`, "m"));
  extract(join(directory, "package.tgz"));
  assert.deepEqual(JSON.parse(await readFile(join(directory, "config/access.json"), "utf8")), { externalUrl: "https://nas.example.com" }, "Only the example origin may be released");
  assert.match(await readFile(join(directory, "LICENSE"), "utf8"), /MIT License/);
  await checkFiles(directory);
  console.log(`Release check passed: ${info.file}, checksum, example origin and package privacy`);
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
