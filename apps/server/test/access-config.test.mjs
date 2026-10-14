import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../dist/index.js";
import { loadExternalOrigin, parseExternalOrigin } from "../dist/access-config.js";

test("external access URL is a single explicit HTTPS origin, not a wildcard or request-derived URL", () => {
  assert.equal(parseExternalOrigin("https://nas.example.com"), "https://nas.example.com");
  assert.equal(parseExternalOrigin("https://NAS.EXAMPLE.COM:443/"), "https://nas.example.com");
  assert.equal(parseExternalOrigin("https://nas.example.com:8443"), "https://nas.example.com:8443");
  for (const value of ["", "http://nas.example.com", "https:nas.example.com", "//nas.example.com", "https://user:pass@nas.example.com",
    "https://*.example.com", "https://nas.example.com/path", "https://nas.example.com/.", "https://nas.example.com?x=1",
    "https://nas.example.com#fragment", " https://nas.example.com", "https://nas.example.com\n", "https://nas.example.com\\evil"]) {
    assert.throws(() => parseExternalOrigin(value), /HTTPS/);
  }
});

test("access configuration loads on startup, explicit override is validated and invalid files fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-access-config-"));
  const config = join(root, "access.json");
  try {
    assert.equal(await loadExternalOrigin(), undefined);
    await writeFile(config, JSON.stringify({ externalUrl: "https://nas.example.com" }));
    assert.equal(await loadExternalOrigin(undefined, config), "https://nas.example.com");
    assert.equal(await loadExternalOrigin("https://other.example", config), "https://other.example");
    await assert.rejects(loadExternalOrigin("http://nas.example.com", config));
    for (const value of ["invalid JSON", "{}", '{"externalUrl":"http://nas.example.com"}', '{"externalUrl":"https://nas.example.com","allowAny":true}']) {
      await writeFile(config, value); await assert.rejects(loadExternalOrigin(undefined, config));
      await assert.rejects(createApplication({ authMode: "dsm-cgi", accessConfigFile: config, dataFile: join(root, "profiles.json") }));
    }
    await assert.rejects(loadExternalOrigin(undefined, join(root, "missing.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit external origin permits browser modules and login through HTTP proxies without permitting foreign origins", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-external-origin-"));
  const web = join(root, "web");
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(web, "index.html"), '<script type="module" src="/assets/fixture.js"></script>');
  await writeFile(join(web, "assets/fixture.js"), "console.log('origin-fixture');");
  const config = join(root, "access.json");
  await writeFile(config, JSON.stringify({ externalUrl: "https://nas.example.com" }));
  let verifiedContext;
  const { server, terminalGateway } = await createApplication({ authMode: "dsm-cgi", accessConfigFile: config,
    webDist: web, dataFile: join(root, "profiles.json"), verifyIdentity: async context => {
      verifiedContext = context;
      return context.cookie === "id=origin-fixture" && context.synoToken === "origin-fixture-token" ? { username: "alice", uid: "1026" } : undefined;
    } });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: "nas.example.com", Origin: "https://nas.example.com", "X-Forwarded-Proto": "http" };
  try {
    const script = await fetch(base + "/assets/fixture.js", { headers });
    assert.equal(script.status, 200); assert.match(await script.text(), /origin-fixture/);
    assert.match(script.headers.get("content-security-policy"), /script-src 'self'/);
    for (const origin of ["https://evil.invalid", "http://nas.example.com", "https://nas.example.com:8443", "https://nas.example.com.evil.invalid", "null"]) {
      assert.equal((await fetch(base + "/assets/fixture.js", { headers: { ...headers, Origin: origin, "X-Forwarded-Proto": "https" } })).status, 403);
      assert.equal((await fetch(base + "/api/auth/session", { method: "POST", headers: { ...headers, Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    }
    const challenge = (await (await fetch(base + "/api/auth/challenge", { headers })).json()).challenge;
    const exchange = await fetch(base + "/api/auth/session", { method: "POST", headers: { ...headers, Cookie: "id=origin-fixture",
      "X-Syno-Token": "origin-fixture-token", "Content-Type": "application/json" }, body: JSON.stringify({ challenge }) });
    assert.equal(exchange.status, 200); assert.equal(verifiedContext.secure, true);
    const { token } = await exchange.json();
    assert.equal((await fetch(base + "/api/profiles", { headers: { ...headers, Authorization: `Bearer ${token}` } })).status, 200);
    assert.equal((await fetch(base + "/api/profiles", { headers })).status, 401);
    assert.equal((await fetch(base + "/api/profiles")).status, 401);
  } finally {
    terminalGateway.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
