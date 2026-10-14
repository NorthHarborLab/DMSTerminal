import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const spk = resolve(process.argv[2]);
const auditDir = await mkdtemp(join(tmpdir(), "dsm-spk-verify-"));
let server;
let output = "";

function extract(archive) {
  const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32/tar.exe") : "tar";
  const result = spawnSync(tar, ["-xf", archive, "-C", auditDir], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
}

async function assertPortableFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Dependency link cannot be packaged: ${path}`);
    if (entry.isDirectory()) await assertPortableFiles(path);
    else assert.ok(!entry.name.endsWith(".node"), `Platform-specific native binary cannot be packaged: ${path}`);
  }
}

try {
  extract(spk);
  extract(join(auditDir, "package.tgz"));
  await assertPortableFiles(join(auditDir, "server/node_modules"));
  for (const metadata of [".modules.yaml", ".pnpm-workspace-state-v1.json"]) {
    await assert.rejects(readFile(join(auditDir, "server/node_modules", metadata)), { code: "ENOENT" });
  }
  const html = await readFile(join(auditDir, "web/index.html"), "utf8");
  const accessConfig = JSON.parse(await readFile(join(auditDir, "config/access.json"), "utf8"));
  const externalUrl = new URL(accessConfig.externalUrl);
  assert.equal(externalUrl.protocol, "https:");
  const externalOrigin = externalUrl.origin;
  assert.match(await readFile(join(auditDir, "LICENSE"), "utf8"), /MIT License/);
  assert.match(await readFile(join(auditDir, "FRONTEND_LICENSES.txt"), "utf8"), /@xterm\/xterm/);
  assert.match(html, /src="\/3rdparty\/DSMTerminal\/assets\//);
  for (const script of await readdir(join(auditDir, "scripts"))) {
    assert.ok(!(await readFile(join(auditDir, "scripts", script))).includes(13), `CRLF in ${script}`);
  }

  const entryAlias = join(auditDir, "server-entry-alias");
  await symlink(join(auditDir, "server"), entryAlias, process.platform === "win32" ? "junction" : "dir");
  const verificationEnv = { ...process.env };
  for (const name of Object.keys(verificationEnv)) {
    if (name.toUpperCase() === "DSM_TERMINAL_EXTERNAL_URL") delete verificationEnv[name];
  }
  server = spawn(process.execPath, [join(entryAlias, "dist/index.js")], {
    cwd: join(auditDir, "server"),
    env: {
      ...verificationEnv,
      NODE_PATH: "",
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "production",
      DSM_TERMINAL_AUTH_MODE: "dsm-cgi",
      DSM_TERMINAL_ACCESS_CONFIG: join(auditDir, "config/access.json"),
      DSM_TERMINAL_DATA: join(auditDir, "profiles.json"),
      DSM_TERMINAL_WEB: join(auditDir, "web")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  server.on("error", (error) => { output += error.message; });

  let match;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    match = output.match(/DSM Terminal listening on http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) break;
    assert.ok(server.exitCode === null && server.signalCode === null, `Packaged server exited:\n${output}`);
    await delay(100);
  }
  assert.ok(match, `Packaged server did not become ready:\n${output}`);
  const base = `http://127.0.0.1:${match[1]}`;
  const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3_000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const profiles = await fetch(`${base}/api/profiles`, { signal: AbortSignal.timeout(3_000) });
  assert.equal(profiles.status, 401, "Packaged server must enforce DSM authentication");
  const page = await fetch(base, { signal: AbortSignal.timeout(3_000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/3rdparty\/DSMTerminal\/assets\//);
  const script = html.match(/src="\/3rdparty\/DSMTerminal(\/assets\/[^\"]+\.js)"/);
  assert.ok(script);
  const asset = await fetch(base + script[1], { headers: { Origin: externalOrigin,
    "X-Forwarded-Proto": "http", Host: externalUrl.host }, signal: AbortSignal.timeout(3_000) });
  assert.equal(asset.status, 200, "HTTPS browser origin must work through an HTTP last-hop proxy");
  assert.match(asset.headers.get("content-type"), /javascript/);
  await asset.arrayBuffer();
  const otherPort = new URL(externalOrigin);
  otherPort.port = externalUrl.port === "8443" ? "9443" : "8443";
  for (const origin of ["https://untrusted.invalid", `http://${externalUrl.host}`, otherPort.origin, "null"]) {
    assert.equal((await fetch(base + script[1], { headers: { Origin: origin, "X-Forwarded-Proto": "https", Host: externalUrl.host } })).status, 403);
  }
  console.log("SPK verification passed: extracted server startup, health, DSM authentication, web assets and portable dependencies");
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  await rm(auditDir, { recursive: true, force: true });
}
