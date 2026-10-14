import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import ssh2 from "ssh2";
import WebSocket from "ws";
import { attachMockSftp } from "../scripts/mock-sftp.mjs";
import { CredentialVault } from "../dist/credential-vault.js";
import { ProfileStore } from "../dist/profile-store.js";

test("encrypted vault survives restart and rejects another owner, profile and modified ciphertext", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-vault-test-"));
  try {
    const vault = new CredentialVault(join(root, "credentials.key")); await vault.load();
    const credential = { password: "plaintext-must-not-persist", privateKey: "private-key-material", passphrase: "key-passphrase" };
    const encrypted = vault.encrypt("alice", "profile-a", credential);
    assert.ok(!JSON.stringify(encrypted).includes(credential.password));
    const reloaded = new CredentialVault(join(root, "credentials.key")); await reloaded.load();
    assert.deepEqual(reloaded.decrypt("alice", "profile-a", encrypted), credential);
    assert.throws(() => reloaded.decrypt("bob", "profile-a", encrypted));
    assert.throws(() => reloaded.decrypt("alice", "profile-b", encrypted));
    const corrupt = Buffer.from(encrypted.ciphertext, "base64"); corrupt[0] ^= 1;
    assert.throws(() => reloaded.decrypt("alice", "profile-a", { ...encrypted, ciphertext: corrupt.toString("base64") }));
    const store = new ProfileStore(join(root, "profiles.json"), vault); await store.load();
    const input = { name: "server", host: "localhost", port: 22, username: "demo", authType: "password", credential, credentialAction: "save" };
    const profile = await store.create(input, "alice");
    assert.equal(profile.hasSavedCredential, true);
    assert.equal(store.list("bob").length, 0);
    assert.throws(() => store.resolveCredential(profile.id, "bob", {}, true));
    assert.ok(!(await readFile(join(root, "profiles.json"), "utf8")).includes(credential.password));
    assert.ok(!JSON.stringify(profile).includes("encryptedCredential"));
    const afterRestart = new ProfileStore(join(root, "profiles.json"), reloaded); await afterRestart.load();
    assert.deepEqual(afterRestart.resolveCredential(profile.id, "alice", {}, true), credential);
    const updated = await afterRestart.update(profile.id, { ...input, host: "changed", credential: undefined, credentialAction: "keep" }, "alice");
    assert.equal(updated.hasSavedCredential, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("SFTP API: DSM identity isolation, fingerprint, streaming transfers, previews and file operations", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-features-test-"));
  const remote = join(root, "remote");
  await mkdir(join(remote, "home/demo"), { recursive: true });
  await writeFile(join(remote, "home/demo/readme.txt"), "hello 中文\n");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=", "base64");
  await writeFile(join(remote, "home/demo/image.png"), png);
  await writeFile(join(remote, "home/demo/unsafe.jpg"), "<svg onload=alert(1)></svg>");
  await writeFile(join(remote, "home/demo/large.txt"), "x".repeat(300 * 1024));
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const userPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  const userKey = ssh2.utils.parseKey(userPrivateKey);
  const clients = new Set();
  const ssh = new ssh2.Server({ hostKeys: [key] }, (client) => {
    let keyAccepted = false;
    clients.add(client); client.on("close", () => clients.delete(client)); client.on("error", () => undefined);
    client.on("authentication", (context) => {
      if (context.method === "publickey" && ["key-user", "both-user"].includes(context.username) && context.key.data.equals(userKey.getPublicSSH()) &&
        (!context.signature || userKey.verify(context.blob, context.signature, context.hashAlgo) === true)) {
        if (context.username === "both-user" && context.signature) { keyAccepted = true; context.reject(["password"], true); }
        else context.accept();
      } else if (context.method === "password" && context.password === "integration-password" && (context.username === "demo" || (context.username === "both-user" && keyAccepted))) context.accept();
      else context.reject(["publickey", "password"], keyAccepted);
    });
    client.on("ready", () => {
      attachMockSftp(client, remote, (session) => {
        session.on("pty", (acceptPty) => acceptPty());
        session.on("shell", (acceptShell) => { const stream = acceptShell(); stream.write("TERMINAL_OK\r\n"); });
      });
    });
  });
  await new Promise((done) => ssh.listen(0, "127.0.0.1", done));
  const sshPort = ssh.address().port;
  const processServer = spawn(process.execPath, [resolve("test/server-fixture.mjs")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", DSM_TERMINAL_AUTH_MODE: "dsm-cgi", DSM_TERMINAL_DATA: join(root, "profiles.json"), DSM_TERMINAL_WEB: resolve("../web/dist") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  processServer.stdout.on("data", (data) => { output += data; });
  processServer.stderr.on("data", (data) => { output += data; });
  try {
    let address;
    for (let i = 0; i < 100; i++) { address = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/); if (address) break; if (processServer.exitCode !== null) throw new Error(output); await delay(50); }
    assert.ok(address, output);
    const base = `http://127.0.0.1:${address[1]}`;
    async function auth(username, uid) {
      const { challenge } = await (await fetch(base + "/api/auth/challenge")).json();
      const authenticated = await fetch(base + "/api/auth/session", { method: "POST",
        headers: { "Content-Type": "application/json", "Cookie": `id=test-${username}`, "X-Syno-Token": "test-syno-token" }, body: JSON.stringify({ challenge }) });
      assert.equal(authenticated.status, 200);
      return (await authenticated.json()).token;
    }
    const alice = await auth("alice", "1026"), bob = await auth("bob", "1027");
    const call = (url, token = alice, method = "GET", body) => fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const create = await call("/api/profiles", alice, "POST", { name: "Integration", host: "127.0.0.1", port: sshPort, username: "demo", authType: "password", credentialAction: "save", credential: { password: "integration-password" } });
    assert.equal(create.status, 201);
    const profile = await create.json();
    assert.equal(profile.hasSavedCredential, true);
    assert.equal((await (await call("/api/profiles", bob)).json()).length, 0);
    assert.equal((await call(`/api/profiles/${profile.id}`, bob, "DELETE")).status, 404);
    const createTicket = async (purpose = "files", fingerprint) => {
      const response = await call("/api/terminal/tickets", alice, "POST", { profileId: profile.id, useSavedCredential: true, purpose, acceptedFingerprint: fingerprint });
      assert.equal(response.status, 201); return (await response.json()).ticket;
    };
    const invalidPrivateKey = await call("/api/profiles", alice, "POST", { name: "Invalid", host: "127.0.0.1", port: sshPort, username: "key-user", authType: "privateKey", credentialAction: "save", credential: { privateKey: "not a private key" } });
    assert.equal(invalidPrivateKey.status, 400);
    const initial = await call("/api/files/sessions", alice, "POST", { ticket: await createTicket() });
    assert.equal(initial.status, 409);
    const fingerprint = (await initial.json()).fingerprint;
    assert.match(fingerprint, /^SHA256:/);
    const crossTicket = await createTicket("files", fingerprint);
    assert.equal((await call("/api/files/sessions", bob, "POST", { ticket: crossTicket })).status, 401);
    const opened = await call("/api/files/sessions", alice, "POST", { ticket: crossTicket });
    const openedPayload = await opened.json();
    assert.equal(opened.status, 201, JSON.stringify(openedPayload));
    const { sessionId, path } = openedPayload;
    assert.equal(path, "/home/demo");
    const prefix = `/api/files/sessions/${sessionId}`;
    assert.equal((await call(`${prefix}/entries?path=/home/demo`, bob)).status, 404);
    const listing = await (await call(`${prefix}/entries?path=/home/demo`)).json();
    assert.ok(listing.entries.some((entry) => entry.name === "readme.txt"));
    assert.equal((await (await call(`${prefix}/preview?path=/home/demo/readme.txt`)).json()).text, "hello 中文\n");
    assert.equal((await (await call(`${prefix}/preview?path=/home/demo/image.png`)).json()).data, png.toString("base64"));
    assert.equal((await call(`${prefix}/preview?path=/home/demo/unsafe.jpg`)).status, 415);
    assert.equal((await (await call(`${prefix}/preview?path=/home/demo/large.txt`)).json()).truncated, true);
    const uploadData = Buffer.alloc(1024 * 1024, 65);
    const upload = (overwrite = false) => fetch(base + prefix + `/upload?path=/home/demo/upload.bin&overwrite=${overwrite}`, { method: "POST", headers: { Authorization: `Bearer ${alice}`, "Content-Type": "application/octet-stream" }, body: uploadData });
    const initialUpload = await upload();
    const initialUploadBody = await initialUpload.json();
    assert.equal(initialUpload.status, 201, JSON.stringify(initialUploadBody));
    assert.deepEqual(await readFile(join(remote, "home/demo/upload.bin")), uploadData);
    assert.equal((await upload()).status, 409);
    assert.equal((await upload(true)).status, 201);
    assert.ok(!(await readdir(join(remote, "home/demo"))).some((name) => name.startsWith(".dsm-terminal-upload-")));
    const downloadTicket = await (await call(`${prefix}/download`, alice, "POST", { path: "/home/demo/upload.bin" })).json();
    const download = await fetch(base + `/api/files/download/${downloadTicket.token}`);
    assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), uploadData);
    assert.equal((await fetch(base + `/api/files/download/${downloadTicket.token}`)).status, 410);
    const operation = (body) => call(`${prefix}/operations`, alice, "POST", body);
    assert.equal((await operation({ operation: "mkdir", path: "/home/demo/new" })).status, 204);
    assert.equal((await operation({ operation: "rename", path: "/home/demo/upload.bin", destination: "/home/demo/new/renamed.bin" })).status, 204);
    assert.equal((await operation({ operation: "chmod", path: "/home/demo/new/renamed.bin", mode: "0644" })).status, 204);
    assert.equal((await operation({ operation: "delete", path: "/" })).status, 400);
    assert.equal((await operation({ operation: "delete", path: "/home/demo/new/renamed.bin" })).status, 204);
    assert.equal((await operation({ operation: "delete", path: "/home/demo/new" })).status, 204);
    const terminalTicket = await createTicket("terminal");
    assert.equal((await call("/api/files/sessions", alice, "POST", { ticket: terminalTicket })).status, 401);
    await new Promise((done, reject) => {
      const ws = new WebSocket(base.replace("http:", "ws:") + "/ws/terminal?ticket=" + terminalTicket);
      const timeout = setTimeout(() => { ws.terminate(); reject(new Error("Terminal timeout")); }, 5_000);
      ws.on("error", reject);
      ws.on("message", (data) => { const message = JSON.parse(data.toString()); if (message.type === "output" && Buffer.from(message.data, "base64").toString().includes("TERMINAL_OK")) { clearTimeout(timeout); ws.close(); done(); } });
    });
    assert.equal((await call(prefix, bob, "DELETE")).status, 404);
    assert.equal((await call(prefix, alice, "DELETE")).status, 204);
    for (const authType of ["privateKey", "passwordAndKey"]) {
      const keyProfile = await (await call("/api/profiles", alice, "POST", { name: authType, host: "127.0.0.1", port: sshPort,
        username: authType === "privateKey" ? "key-user" : "both-user", authType, credentialAction: "save", credential: { privateKey: userPrivateKey, password: "integration-password" } })).json();
      assert.equal(keyProfile.hasSavedCredential, true);
      const tokenResponse = await call("/api/terminal/tickets", alice, "POST", { profileId: keyProfile.id, useSavedCredential: true, purpose: "files", acceptedFingerprint: fingerprint });
      assert.equal(tokenResponse.status, 201);
      const keySessionResponse = await call("/api/files/sessions", alice, "POST", { ticket: (await tokenResponse.json()).ticket });
      const keySession = await keySessionResponse.json();
      assert.equal(keySessionResponse.status, 201, JSON.stringify(keySession));
      assert.equal((await call(`/api/files/sessions/${keySession.sessionId}`, alice, "DELETE")).status, 204);
    }
    const httpTicket = await createTicket("terminal");
    const httpCreated = await call("/api/terminal/http-sessions", alice, "POST", { ticket: httpTicket });
    assert.equal(httpCreated.status, 201);
    const httpId = (await httpCreated.json()).sessionId;
    assert.equal((await call(`/api/terminal/http-sessions/${httpId}/events`, bob)).status, 409);
    let httpConnected = false;
    for (let i = 0; i < 5 && !httpConnected; i++) {
      const events = await (await call(`/api/terminal/http-sessions/${httpId}/events`)).json();
      httpConnected = events.events.some((event) => event.type === "status" && event.status === "connected");
    }
    assert.equal(httpConnected, true);
    assert.equal((await call(`/api/terminal/http-sessions/${httpId}`, alice, "DELETE")).status, 204);
    assert.ok(!(await readFile(join(root, "profiles.json"), "utf8")).includes("integration-password"));
    assert.ok(!(await readFile(join(root, "profiles.json"), "utf8")).includes('"username": "demo"'));
    assert.ok(!(await readFile(join(root, "profiles.json"), "utf8")).includes("BEGIN RSA PRIVATE KEY"));
  } finally {
    if (processServer.exitCode === null) { const exit = once(processServer, "exit"); processServer.kill(); await exit; }
    for (const client of clients) client.end();
    await new Promise((done) => ssh.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
