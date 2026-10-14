import { randomBytes } from "node:crypto";
import type { Request, RequestHandler } from "express";
import type { DsmIdentity } from "./dsm-identity.js";

interface ChallengeRecord {
  expiresAt: number;
}

interface SessionRecord {
  expiresAt: number;
  ownerId: string;
}

const CHALLENGE_TTL_MS = 60_000;
const SESSION_TTL_MS = 60 * 60_000;
const MAX_RECORDS = 1_024;

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length);
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

export class DsmAuthBroker {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private verifying = 0;

  issueChallenge(): string {
    this.prune();
    this.limitSize(this.challenges);
    const challenge = randomBytes(32).toString("hex");
    this.challenges.set(challenge, { expiresAt: Date.now() + CHALLENGE_TTL_MS });
    return challenge;
  }

  async exchangeChallenge(challenge: string, verify: () => Promise<DsmIdentity | undefined>): Promise<string | undefined> {
    this.prune();
    const record = this.challenges.get(challenge);
    if (!/^[a-f0-9]{64}$/.test(challenge) || !record || record.expiresAt <= Date.now()) return undefined;
    // Consume before awaiting the trusted verifier, including failed authentication attempts
    this.challenges.delete(challenge);
    if (this.verifying >= 8) return undefined;
    this.verifying++;
    let identity: DsmIdentity | undefined;
    try { identity = await verify(); } catch { return undefined; }
    finally { this.verifying--; }
    if (!identity || record.expiresAt <= Date.now() || !identity.username || identity.username.length > 256 ||
      /[\x00-\x1f\x7f]/.test(identity.username) || !/^\d{1,10}$/.test(identity.uid)) return undefined;
    this.limitSize(this.sessions);
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS, ownerId: `dsm:${identity.uid}:${identity.username}` });
    return token;
  }

  authenticate(request: Request): string | undefined {
    this.prune();
    const token = bearerToken(request);
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) return undefined;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session.ownerId;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, value] of this.challenges) {
      if (value.expiresAt <= now) this.challenges.delete(key);
    }
    for (const [key, value] of this.sessions) {
      if (value.expiresAt <= now) this.sessions.delete(key);
    }
  }

  private limitSize<T>(records: Map<string, T>): void {
    while (records.size >= MAX_RECORDS) {
      const oldest = records.keys().next().value as string | undefined;
      if (!oldest) return;
      records.delete(oldest);
    }
  }
}

export function createDsmAuthMiddleware(broker: DsmAuthBroker, mode: "development" | "dsm-cgi"): RequestHandler {
  if (mode === "development") {
    return (_request, response, next) => {
      response.locals.dsmUser = "local-development";
      next();
    };
  }

  return (request, response, next) => {
    const ownerId = broker.authenticate(request);
    if (ownerId) {
      response.locals.dsmUser = ownerId;
      next();
      return;
    }
    response.status(401).json({
      error: "DSM 应用会话无效，请从 DSM 桌面重新打开",
      code: "DSM_APP_SESSION_REQUIRED"
    });
  };
}
