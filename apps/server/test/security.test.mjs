import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import ssh2 from "ssh2";
import WebSocket from "ws";
import { createApplication } from "../dist/index.js";
import { createDsmIdentityVerifier } from "../dist/dsm-identity.js";
import { DsmAuthBroker } from "../dist/dsm-auth.js";
import { HttpTerminalTransport, HttpTerminalManager } from "../dist/http-terminal-manager.js";
import { TerminalLimits, TerminalLimitError } from "../dist/terminal-limits.js";
import { TicketStore } from "../dist/ticket-store.js";

test("DSM verifier uses only fixed helpers and authentic CGI output, never a claimed identity", async () => {
  const calls = [];
  const context = { cookie: "id=fixture-session", synoToken: "fixture+/=token", remoteAddress: "192.0.2.10", serverAddress: "192.0.2.20", secure: true, username: "bob", uid: "0", executable: "attacker-command" };
  const verifier = createDsmIdentityVerifier({ executable: async (paths) => paths[0], run: async (file, args, env) => {
    calls.push({ file, args, env }); return file.endsWith("authenticate.cgi") ? "alice\n" : "1026\n";
  } });
  assert.deepEqual(await verifier(context), { username: "alice", uid: "1026" });
  assert.equal(calls[0].file, "/usr/syno/synoman/webman/modules/authenticate.cgi");
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].env.HTTP_COOKIE, context.cookie);
  assert.equal(new URLSearchParams(calls[0].env.QUERY_STRING).get("SynoToken"), context.synoToken);
  assert.equal(calls[0].env.REMOTE_ADDR, context.remoteAddress);
  assert.equal(calls[0].env.SERVER_ADDR, context.serverAddress);
  assert.equal(calls[0].env.HTTP_REMOTE_USER, undefined);
  assert.equal(calls[0].env.NODE_OPTIONS, undefined);
  assert.deepEqual(calls[1].args, ["-u", "--", "alice"]);
  for (const output of ["", "alice\nbob\n", "alice\u0000", "<html>\nerror\n"]) {
    const invalid = createDsmIdentityVerifier({ executable: async (paths) => paths[0], run: async () => output });
    assert.equal(await invalid(context), undefined);
  }
  assert.equal(await createDsmIdentityVerifier({ executable: async () => undefined, run: async () => { throw new Error("must not execute"); } })(context), undefined);
  assert.equal(await createDsmIdentityVerifier({ executable: async (paths) => paths[0], run: async () => { throw new Error("timeout or permission denied"); } })(context), undefined);
});

test("auth completion aliases cannot install identity; nonce exchange is single-use and fail-closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-auth-security-"));
  let verifications = 0;
  const application = await createApplication({ dataFile: join(root, "profiles.json"), authMode: "dsm-cgi", verifyIdentity: async (context) => {
    verifications++; await delay(10);
    return context.cookie === "id=alice-fixture" && context.synoToken === "fixture-token" ? { username: "alice", uid: "1026" } : undefined;
  } });
  const { server, terminalGateway } = application;
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const challenge = async () => (await (await fetch(base + "/api/auth/challenge")).json()).challenge;
  const exchange = (value, authenticated = false, extra = {}) => fetch(base + "/api/auth/session", { method: "POST",
    headers: { "Content-Type": "application/json", ...(authenticated ? { Cookie: "id=alice-fixture", "X-Syno-Token": "fixture-token" } : {}) },
    body: JSON.stringify({ challenge: value, ...extra }) });
  try {
    for (const path of ["/internal/auth/complete", "/internal/auth/complete/", "/INTERNAL/AUTH/COMPLETE", "/%69nternal/auth/complete", "/internal//auth/complete"]) {
      const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ challenge: await challenge(), username64: Buffer.from("bob").toString("base64"), uid: "1027" }) });
      assert.equal(response.status, 404, path);
    }
    assert.equal(verifications, 0);
    const abandoned = await challenge();
    assert.equal((await exchange(abandoned)).status, 401);
    assert.equal((await exchange(abandoned, true)).status, 401);
    assert.equal(verifications, 0);
    assert.equal((await exchange(await challenge(), true, { username: "bob", uid: "0" })).status, 400);
    const shared = await challenge();
    const responses = await Promise.all([exchange(shared, true), exchange(shared, true)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
    assert.equal(verifications, 1);
    const token = (await responses.find((response) => response.status === 200).json()).token;
    const saved = await fetch(base + "/api/profiles", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "owned", host: "localhost", port: 22, username: "demo", authType: "password" }) });
    assert.equal(saved.status, 201);
    const listing = await fetch(base + "/api/profiles", { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await listing.json()).length, 1);
    assert.match(listing.headers.get("content-security-policy"), /object-src 'none'/);
    const foreign = await fetch(base + "/api/auth/session", { method: "POST", headers: { Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ challenge: await challenge() }) });
    assert.equal(foreign.status, 403);
    assert.equal((await exchange("not-a-challenge", true)).status, 400);
  } finally {
    terminalGateway.close();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});

test("authentication errors, concurrent exchange and verifier saturation never reuse a nonce", async () => {
  const broker = new DsmAuthBroker();
  const nonce = broker.issueChallenge();
  assert.equal(await broker.exchangeChallenge(nonce, async () => { throw new Error("helper failed"); }), undefined);
  assert.equal(await broker.exchangeChallenge(nonce, async () => ({ username: "alice", uid: "1026" })), undefined);
  let unblock;
  const wait = new Promise((done) => { unblock = done; });
  const pending = Array.from({ length: 8 }, () => broker.exchangeChallenge(broker.issueChallenge(), async () => { await wait; return { username: "alice", uid: "1026" }; }));
  const rejected = broker.issueChallenge();
  assert.equal(await broker.exchangeChallenge(rejected, async () => { throw new Error("must not run"); }), undefined);
  unblock(); assert.ok((await Promise.all(pending)).every(Boolean));
  assert.equal(await broker.exchangeChallenge(rejected, async () => ({ username: "alice", uid: "1026" })), undefined);
});

class ResponseFixture extends EventEmitter {
  writableEnded = false;
  writableLength = 0;
  locals = { dsmUser: "alice" };
  headers = {};
  status() { return this; }
  setHeader(name, value) { this.headers[name] = value; return this; }
  flushHeaders() {}
  write(data) { this.writableLength += Buffer.byteLength(data); return true; }
  end() { this.writableEnded = true; this.emit("close"); }
  json(payload) { this.payload = payload; this.end(); return this; }
}
const timing = { attachMs: 100, leaseMs: 150, pollMs: 30, retentionMs: 50 };

test("HTTP attach, immediate poll, empty poll and aborted poll all reclaim abandoned transports", async () => {
  for (const mode of ["no-attach", "queued", "empty", "abort"]) {
    let finished = 0, closed = 0;
    const transport = new HttpTerminalTransport(() => finished++, timing);
    transport.onClose(() => closed++);
    const response = new ResponseFixture();
    if (mode === "queued") transport.send({ type: "status", status: "connecting" });
    if (mode !== "no-attach") assert.equal(transport.poll(response), true);
    if (mode === "abort") response.emit("close");
    // SSH output must not renew the client lease
    const output = setInterval(() => transport.send({ type: "output", data: "eA==" }), 20);
    await delay(260); clearInterval(output);
    assert.equal(finished, 1, mode); assert.equal(closed, 1, mode);
    assert.equal(transport.poll(new ResponseFixture()), false);
  }
});

test("normal polling survives multiple leases; duplicate poll, streaming and closed retention remain correct", async () => {
  let finished = 0;
  const transport = new HttpTerminalTransport(() => finished++, timing);
  const pending = new ResponseFixture();
  assert.equal(transport.poll(pending), true);
  assert.equal(transport.poll(new ResponseFixture()), false);
  pending.emit("close");
  for (let i = 0; i < 7; i++) {
    transport.send({ type: "status", status: "connected" });
    const response = new ResponseFixture(); assert.equal(transport.poll(response), true);
    assert.equal(response.payload.closed, false);
    await delay(50); assert.equal(finished, 0);
  }
  transport.close();
  const last = new ResponseFixture(); assert.equal(transport.poll(last), true);
  assert.equal(last.payload.closed, true);
  await delay(100); assert.equal(finished, 1);
  const stream = new HttpTerminalTransport(() => finished++, timing);
  const response = new ResponseFixture(); assert.equal(stream.attachStream(response), true);
  assert.equal(stream.poll(new ResponseFixture()), false);
  response.emit("close"); assert.equal(finished, 2);
  const congested = new HttpTerminalTransport(() => finished++, timing);
  const slow = new ResponseFixture(); congested.attachStream(slow); slow.writableLength = 1024 * 1024;
  congested.send({ type: "output", data: "eA==" }); assert.equal(finished, 3);
});

test("shared quota has per-owner and global caps and releases idempotently", () => {
  const limits = new TerminalLimits(2, 3);
  const a = limits.acquire("alice"), b = limits.acquire("alice"), c = limits.acquire("bob");
  assert.throws(() => limits.acquire("alice"), TerminalLimitError);
  assert.throws(() => limits.acquire("charlie"), TerminalLimitError);
  a(); a(); const d = limits.acquire("charlie");
  b(); c(); d();
  const reusable = limits.acquire("alice"); reusable();
  const tickets = new TicketStore();
  const token = tickets.issue({ purpose: "files", ownerId: "alice" });
  assert.equal(tickets.consume(token, "terminal"), undefined);
  assert.ok(tickets.consume(token, "files", "alice"));
});

test("HTTP lease destroys the actual SSH socket even when its peer keeps TCP half-open", { timeout: 10_000 }, async () => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const fingerprint = "SHA256:" + createHash("sha256").update(ssh2.utils.parseKey(key).getPublicSSH()).digest("base64").replace(/=+$/, "");
  const peers = new Set();
  let ready = 0;
  const ssh = new ssh2.Server({ hostKeys: [key] }, (client) => {
    peers.add(client); client.on("error", () => undefined);
    client.on("authentication", (context) => context.method === "password" ? context.accept() : context.reject());
    client.on("ready", () => client.on("session", (accept) => {
      const session = accept(); session.on("pty", (acceptPty) => acceptPty());
      session.on("shell", (acceptShell) => {
        acceptShell().write("QUIET\r\n"); ready++;
        client._sock.allowHalfOpen = true;
        client._sock.pause();
      });
    }));
  });
  await new Promise((done) => ssh.listen(0, "127.0.0.1", done));
  const port = ssh.address().port;
  const tickets = new TicketStore(), limits = new TerminalLimits(1, 1);
  const manager = new HttpTerminalManager({ trustFingerprint: async () => undefined }, tickets, limits,
    { attachMs: 2000, leaseMs: 100, pollMs: 20, retentionMs: 30 });
  const profile = { id: "fixture-profile", host: "127.0.0.1", port, username: "demo", authType: "password", hostFingerprint: fingerprint };
  try {
    for (let i = 0; i < 3; i++) {
      const ticket = tickets.issue({ profile, credential: { password: "fixture" }, ownerId: "alice", purpose: "terminal", cols: 80, rows: 24 });
      const id = manager.create(ticket, "alice"); assert.ok(id);
      for (let tries = 0; tries < 100 && ready !== i + 1; tries++) await delay(10);
      assert.equal(ready, i + 1);
      assert.equal(manager.poll(id, new ResponseFixture()), true);
      await delay(220);
      assert.equal(manager.poll(id, new ResponseFixture()), false);
      const remaining = process._getActiveHandles().filter((handle) => handle.remotePort === port && !handle.destroyed);
      assert.equal(remaining.length, 0, "expired SSH client sockets must not accumulate after quota release");
    }
  } finally {
    for (const peer of peers) peer._sock.destroy();
    await new Promise((done) => ssh.close(done));
  }
});

async function rawUpgrade(port, ticket, frame) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let output = "";
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("Raw socket timeout")); }, 5000);
    socket.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
    socket.on("data", (data) => { output += data.toString("latin1"); });
    socket.on("close", () => { clearTimeout(timeout); resolve(output); });
    socket.on("connect", () => {
      const header = `GET /ws/terminal${ticket ? "?ticket=" + ticket : ""} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n\r\n`;
      // Pipelined data tests the parser before application connection callbacks finish
      socket.write(frame ? Buffer.concat([Buffer.from(header), frame]) : header);
    });
  });
}

test("invalid tickets and malformed WS frames cannot crash the actual backend; valid SSH stays usable", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-ws-security-"));
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const fingerprint = "SHA256:" + createHash("sha256").update(ssh2.utils.parseKey(key).getPublicSSH()).digest("base64").replace(/=+$/, "");
  const clients = new Set();
  const ssh = new ssh2.Server({ hostKeys: [key] }, (client) => {
    clients.add(client); client.on("error", () => undefined); client.on("close", () => clients.delete(client));
    client.on("authentication", (context) => context.method === "password" && context.username === "demo" && context.password === "fixture-password" ? context.accept() : context.reject());
    client.on("ready", () => client.on("session", (accept) => {
      const session = accept(); session.on("pty", (acceptPty) => acceptPty());
      session.on("window-change", (acceptWindow) => acceptWindow?.());
      session.on("shell", (acceptShell) => { const stream = acceptShell(); stream.write("READY\r\n"); stream.on("data", (data) => stream.write(data)); });
    }));
  });
  await new Promise((done) => ssh.listen(0, "127.0.0.1", done));
  const backend = spawn(process.execPath, [resolve("dist/index.js")], { env: { ...process.env, NODE_ENV: "development", DSM_TERMINAL_AUTH_MODE: "development", HOST: "127.0.0.1", PORT: "0", DSM_TERMINAL_DATA: join(root, "profiles.json") }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", good;
  backend.stdout.on("data", (data) => { output += data; }); backend.stderr.on("data", (data) => { output += data; });
  try {
    let address;
    for (let i = 0; i < 100; i++) { address = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/); if (address) break; assert.equal(backend.exitCode, null, output); await delay(30); }
    assert.ok(address, output); const port = Number(address[1]), base = `http://127.0.0.1:${port}`;
    const post = async (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const profile = await (await post("/api/profiles", { name: "ws-test", host: "127.0.0.1", port: ssh.address().port, username: "demo", authType: "password" })).json();
    const ticket = async (purpose = "terminal") => (await (await post("/api/terminal/tickets", { profileId: profile.id, credential: { password: "fixture-password" }, acceptedFingerprint: fingerprint, purpose })).json()).ticket;
    assert.match(await rawUpgrade(port), /^HTTP\/1.1 401/);
    assert.match(await rawUpgrade(port, "invalid"), /^HTTP\/1.1 401/);
    assert.match(await rawUpgrade(port, await ticket("files")), /^HTTP\/1.1 401/);
    const original = await ticket();
    good = new WebSocket(base.replace("http:", "ws:") + "/ws/terminal?ticket=" + original);
    const received = [];
    good.on("error", () => undefined);
    good.on("message", (data) => { const message = JSON.parse(data.toString()); if (message.type === "output") received.push(Buffer.from(message.data, "base64").toString()); });
    await once(good, "open");
    for (let i = 0; i < 100 && !received.join("").includes("READY"); i++) await delay(20);
    assert.ok(received.join("").includes("READY"));
    assert.match(await rawUpgrade(port, original), /^HTTP\/1.1 401/);
    const oversized = Buffer.alloc(14); oversized[0] = 0x82; oversized[1] = 0xff; oversized.writeBigUInt64BE(524289n, 2);
    for (const frame of [Buffer.from([0x81, 0x01, 0x41]), Buffer.from([0x83, 0x80, 1, 2, 3, 4]), oversized]) {
      assert.match(await rawUpgrade(port, await ticket(), frame), /^HTTP\/1.1 101/);
      assert.equal(backend.exitCode, null, output);
      assert.equal((await fetch(base + "/api/health")).status, 200);
    }
    good.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    good.send(JSON.stringify({ type: "input", data: "STILL_ALIVE\r" }));
    for (let i = 0; i < 100 && !received.join("").includes("STILL_ALIVE"); i++) await delay(20);
    assert.ok(received.join("").includes("STILL_ALIVE"));
    const invalid = new WebSocket(base.replace("http:", "ws:") + "/ws/terminal?ticket=" + await ticket());
    invalid.on("error", () => undefined); await once(invalid, "open");
    invalid.send(JSON.stringify({ type: "resize", cols: 999999, rows: 30 }));
    const [code] = await once(invalid, "close"); assert.equal(code, 1008);
    assert.equal((await fetch(base + "/api/health")).status, 200);
    const connectionTickets = await Promise.all(Array.from({ length: 8 }, () => ticket()));
    const sessions = [];
    // One WS is still live, so only seven additional HTTP connections fit the shared owner quota
    for (const token of connectionTickets) {
      const response = await post("/api/terminal/http-sessions", { ticket: token });
      if (sessions.length === 7) assert.equal(response.status, 429);
      else { assert.equal(response.status, 201); sessions.push((await response.json()).sessionId); }
    }
    for (const id of sessions) await fetch(base + "/api/terminal/http-sessions/" + id, { method: "DELETE" });
    const reopened = await post("/api/terminal/http-sessions", { ticket: await ticket() });
    assert.equal(reopened.status, 201);
    await fetch(base + "/api/terminal/http-sessions/" + (await reopened.json()).sessionId, { method: "DELETE" });
    const missingAuth = await post("/api/auth/session", { challenge: (await (await fetch(base + "/api/auth/challenge")).json()).challenge });
    assert.equal(missingAuth.status, 401);
  } finally {
    good?.terminate();
    if (backend.exitCode === null) { const exit = once(backend, "exit"); backend.kill(); await exit; }
    for (const client of clients) client.end(); await new Promise((done) => ssh.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
