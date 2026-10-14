import { dirname, resolve } from "node:path";
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { ProfileStore } from "./profile-store.js";
import { TicketStore } from "./ticket-store.js";
import { createTerminalGateway } from "./terminal-gateway.js";
import { createDsmAuthMiddleware, DsmAuthBroker } from "./dsm-auth.js";
import { HttpTerminalManager } from "./http-terminal-manager.js";
import { CredentialVault } from "./credential-vault.js";
import { FileError, SftpManager } from "./sftp-manager.js";
import { installDownloadRoute, installFileRoutes } from "./file-routes.js";
import { credentialProblem } from "./credential-validation.js";
import { fileURLToPath } from "node:url";
import { readDsmAuthContext, verifyDsmIdentity, type DsmIdentityVerifier } from "./dsm-identity.js";
import { TerminalLimits } from "./terminal-limits.js";
import { terminalMessageSchema } from "./terminal-messages.js";
import { loadExternalOrigin } from "./access-config.js";

const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "127.0.0.1";

const credentialSchema = z.object({
  password: z.string().max(4096).optional(),
  privateKey: z.string().max(100_000).optional(),
  passphrase: z.string().max(4096).optional()
});

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(128),
  authType: z.enum(["password", "privateKey", "passwordAndKey"]),
  credential: credentialSchema.optional(),
  credentialAction: z.enum(["keep", "save", "remove"]).default("keep")
}).superRefine((profile, context) => {
  if (profile.credentialAction !== "save") return;
  const problem = credentialProblem(profile.authType, profile.credential ?? {});
  if (problem) context.addIssue({ code: "custom", message: problem });
});

const ticketSchema = z.object({
  profileId: z.string().uuid(),
  credential: credentialSchema.default({}),
  useSavedCredential: z.boolean().default(false),
  purpose: z.enum(["terminal", "files"]).default("terminal"),
  acceptedFingerprint: z.string().max(256).optional(),
  cols: z.number().int().min(20).max(1000).default(120),
  rows: z.number().int().min(5).max(500).default(36)
});

const httpSessionSchema = z.object({
  ticket: z.string().min(1).max(512)
});
const appSessionSchema = z.object({ challenge: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export interface ApplicationOptions {
  dataFile?: string;
  webDist?: string;
  authMode?: "development" | "dsm-cgi";
  verifyIdentity?: DsmIdentityVerifier;
  externalUrl?: string;
  accessConfigFile?: string;
}

export async function createApplication(options: ApplicationOptions = {}) {
  const dataFile = options.dataFile ?? process.env.DSM_TERMINAL_DATA ?? resolve(process.cwd(), "data/profiles.json");
  const webDist = options.webDist ?? process.env.DSM_TERMINAL_WEB ?? resolve(process.cwd(), "../web/dist");
  const configuredMode = options.authMode ?? process.env.DSM_TERMINAL_AUTH_MODE ?? (process.env.NODE_ENV === "production" ? "" : "development");
  if (configuredMode !== "development" && configuredMode !== "dsm-cgi") throw new Error("请明确配置有效的 DSM 身份验证模式");
  if (configuredMode === "development" && !["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error("未鉴权的开发模式只能监听回环地址");
  }
  const identityVerifier = options.verifyIdentity ?? verifyDsmIdentity;
  const externalOrigin = await loadExternalOrigin(options.externalUrl ?? process.env.DSM_TERMINAL_EXTERNAL_URL,
    options.accessConfigFile ?? process.env.DSM_TERMINAL_ACCESS_CONFIG);
  const terminalLimits = new TerminalLimits();
  const vault = new CredentialVault(resolve(dirname(dataFile), "credentials.key"));
  await vault.load();
  const profileStore = new ProfileStore(dataFile, vault);
  await profileStore.load();
  const ticketStore = new TicketStore();
  const dsmAuthBroker = new DsmAuthBroker();
  const httpTerminalManager = new HttpTerminalManager(profileStore, ticketStore, terminalLimits);
  const sftpManager = new SftpManager(profileStore, ticketStore);

  const app = express();
  app.disable("etag");
  app.disable("x-powered-by");
  app.enable("case sensitive routing");
  app.enable("strict routing");
  app.set("trust proxy", "loopback");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    if (configuredMode === "development" && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.get("host") ?? "")) {
      response.status(403).json({ error: "开发服务仅允许回环主机访问" }); return;
    }
    const origin = request.get("origin");
    const expectedOrigin = externalOrigin ?? `${request.protocol}://${request.get("host")}`;
    if (origin && origin !== expectedOrigin) {
      response.status(403).json({ error: "不允许跨来源访问" }); return;
    }
    next();
  });
  app.use(express.json({ limit: "128kb" }));

  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/auth/challenge", (_request, response) => {
    response.json({ challenge: dsmAuthBroker.issueChallenge() });
  });

  app.all(/^\/internal(?:\/|$)/i, (_request, response) => { response.status(404).end(); });

  app.post("/api/auth/session", async (request, response) => {
    const parsed = appSessionSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "身份验证请求无效" });
    const { challenge } = parsed.data;
    const context = readDsmAuthContext(request);
    // The explicit HTTPS deployment URL, not an arbitrary forwarded header, defines external TLS
    if (context && externalOrigin) context.secure = true;
    const token = await dsmAuthBroker.exchangeChallenge(challenge, () => context ? identityVerifier(context) : Promise.resolve(undefined));
    return token
      ? response.json({ token, expiresIn: 3_600 })
      : response.status(401).json({ error: "DSM 身份验证未完成", code: "DSM_CGI_AUTH_REQUIRED" });
  });

  installDownloadRoute(app, sftpManager);
  app.use("/api", createDsmAuthMiddleware(dsmAuthBroker, configuredMode));
  installFileRoutes(app, sftpManager);

  app.get("/api/profiles", (_request, response) => response.json(profileStore.list(response.locals.dsmUser)));

  app.post("/api/profiles", async (request, response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "服务器配置无效", details: parsed.error.issues });
    return response.status(201).json(await profileStore.create(parsed.data, response.locals.dsmUser));
  });

  app.put("/api/profiles/:id", async (request, response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "服务器配置无效", details: parsed.error.issues });
    const updated = await profileStore.update(request.params.id, parsed.data, response.locals.dsmUser);
    return updated ? response.json(updated) : response.status(404).json({ error: "服务器不存在" });
  });

  app.delete("/api/profiles/:id", async (request, response) => {
    return (await profileStore.delete(request.params.id, response.locals.dsmUser))
      ? response.status(204).end()
      : response.status(404).json({ error: "服务器不存在" });
  });

  app.post("/api/terminal/tickets", (request, response) => {
    const parsed = ticketSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "连接参数无效", details: parsed.error.issues });
    const ownerId = response.locals.dsmUser as string;
    const profile = profileStore.get(parsed.data.profileId, ownerId);
    if (!profile) return response.status(404).json({ error: "服务器不存在" });
    let credential;
    try {
      credential = profileStore.resolveCredential(profile.id, ownerId, parsed.data.credential, parsed.data.useSavedCredential);
    } catch {
      return response.status(400).json({ error: "无法读取保存的凭据, 请重新输入并保存" });
    }
    if (profile.authType !== "privateKey" && !credential.password) {
      return response.status(400).json({ error: "请输入 SSH 密码" });
    }
    if (profile.authType !== "password" && !credential.privateKey) {
      return response.status(400).json({ error: "请输入 SSH 私钥" });
    }
    const problem = credentialProblem(profile.authType, credential);
    if (problem) return response.status(400).json({ error: problem });
    const ticket = ticketStore.issue({ profile, credential, ownerId, purpose: parsed.data.purpose,
      acceptedFingerprint: parsed.data.acceptedFingerprint, cols: parsed.data.cols, rows: parsed.data.rows });
    return response.status(201).json({ ticket });
  });

  app.post("/api/terminal/http-sessions", (request, response) => {
    const parsed = httpSessionSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "连接凭证无效" });
    const sessionId = httpTerminalManager.create(parsed.data.ticket, response.locals.dsmUser);
    return sessionId
      ? response.status(201).json({ sessionId })
      : response.status(401).json({ error: "连接凭证无效或已过期" });
  });

  app.get("/api/terminal/http-sessions/:id/stream", (request, response) => {
    if (!httpTerminalManager.attachStream(request.params.id, response)) {
      return response.status(404).json({ error: "终端会话不存在或已关闭" });
    }
  });

  app.get("/api/terminal/http-sessions/:id/events", (request, response) => {
    if (!httpTerminalManager.poll(request.params.id, response)) {
      return response.status(409).json({ error: "终端事件请求冲突或会话不存在" });
    }
  });

  app.post("/api/terminal/http-sessions/:id/messages", (request, response) => {
    const parsed = terminalMessageSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "终端消息无效" });
    return httpTerminalManager.receive(request.params.id, parsed.data, response.locals.dsmUser)
      ? response.status(204).end()
      : response.status(404).json({ error: "终端会话不存在或已关闭" });
  });

  app.delete("/api/terminal/http-sessions/:id", (request, response) => {
    return httpTerminalManager.close(request.params.id, response.locals.dsmUser)
      ? response.status(204).end()
      : response.status(404).json({ error: "终端会话不存在或已关闭" });
  });

  app.use("/assets", express.static(resolve(webDist, "assets"), {
    immutable: true,
    index: false,
    maxAge: "1y"
  }));
  app.use("/assets", (_request, response) => {
    response.status(404).type("text/plain").send("Static asset not found. Reload DSM Terminal.");
  });
  app.use(express.static(webDist, {
    etag: false,
    index: false,
    lastModified: false,
    maxAge: 0,
    setHeaders(response) {
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    }
  }));
  app.get("/{*path}", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    return response.type("html").send(await readFile(resolve(webDist, "index.html")));
  });

  const handleError: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) { next(error); return; }
    const status = error instanceof FileError ? error.status : error.code === 2 ? 404 : error.code === 3 ? 403 : Number(error.status) || 500;
    response.status(status).json({ error: error.message ?? "操作失败, 请重试", code: error.code, fingerprint: error.fingerprint });
  };
  app.use(handleError);

  const server = createServer(app);
  const terminalGateway = createTerminalGateway(profileStore, ticketStore, terminalLimits);

  server.on("upgrade", (request, socket, head) => {
    try {
    const url = new URL(request.url ?? "/", "http://localhost");
    console.log(
      `WebSocket upgrade path=${url.pathname} upgrade=${request.headers.upgrade ?? "missing"} ` +
      `connection=${request.headers.connection ?? "missing"}`
    );
    if (url.pathname !== "/ws/terminal") {
      console.warn(`Rejected WebSocket upgrade for unexpected path: ${url.pathname}`);
      socket.destroy();
      return;
    }
      terminalGateway.handleUpgrade(request, socket, head, (webSocket) => {
        console.log("WebSocket upgrade accepted");
        terminalGateway.emit("connection", webSocket, request);
      });
    } catch (error) {
      console.error("WebSocket upgrade failed", error);
      socket.destroy();
    }
  });

  return { app, server, terminalGateway };
}

if (process.argv[1] && (await realpath(resolve(process.argv[1])).catch(() => undefined)) === (await realpath(fileURLToPath(import.meta.url)))) {
  const { server } = await createApplication();
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = address && typeof address === "object" ? address.port : port;
    console.log(`DSM Terminal listening on http://${host}:${listeningPort}`);
  });
}
