import { randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { posix } from "node:path";
import { Client, type ConnectConfig, type SFTPWrapper, type Stats, type FileEntry } from "ssh2";
import type { ProfileStore } from "./profile-store.js";
import type { TicketStore } from "./ticket-store.js";
import type { TerminalTicket } from "./types.js";

export class FileError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code?: string, public readonly fingerprint?: string) { super(message); }
}

export function remotePath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new FileError("请输入有效的远程绝对路径");
  }
  return posix.normalize(value);
}

export function sftpCall<T>(operation: (callback: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => operation((error, value) => error ? reject(error) : resolve(value)));
}

interface FileSession {
  ownerId: string;
  client: Client;
  socket: Socket;
  sftp: SFTPWrapper;
  lastUsed: number;
  busy: number;
}

const IDLE_TIMEOUT_MS = 30 * 60_000;

export class SftpManager {
  private readonly sessions = new Map<string, FileSession>();
  private readonly opening = new Map<string, number>();

  constructor(private readonly profiles: ProfileStore, private readonly tickets: TicketStore) {
    const sweep = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (!session.busy && Date.now() - session.lastUsed > IDLE_TIMEOUT_MS) this.close(id, session.ownerId);
      }
    }, 60_000);
    sweep.unref();
  }

  async create(token: string, ownerId: string): Promise<{ sessionId: string; path: string }> {
    const count = [...this.sessions.values()].filter((session) => session.ownerId === ownerId).length + (this.opening.get(ownerId) ?? 0);
    if (count >= 8) throw new FileError("最多同时打开 8 个文件连接, 请先关闭其他连接", 429);
    if (this.sessions.size + [...this.opening.values()].reduce((total, value) => total + value, 0) >= 64) {
      throw new FileError("文件连接总数达到上限, 请稍后重试", 429);
    }
    const ticket = this.tickets.consume(token, "files", ownerId);
    if (!ticket) throw new FileError("文件连接凭证无效或已过期", 401);
    this.opening.set(ownerId, (this.opening.get(ownerId) ?? 0) + 1);
    try {
      return await this.connect(ticket, ownerId);
    } finally {
      const remaining = (this.opening.get(ownerId) ?? 1) - 1;
      if (remaining) this.opening.set(ownerId, remaining);
      else this.opening.delete(ownerId);
    }
  }

  private async connect(ticket: TerminalTicket, ownerId: string): Promise<{ sessionId: string; path: string }> {
    const client = new Client();
    let socket: Socket | undefined;
    const profile = ticket.profile;
    let observed: string | undefined;
    let accepted = false;
    let id: string | undefined;
    const config: ConnectConfig = {
      host: profile.host, port: profile.port, username: profile.username,
      readyTimeout: 15_000, keepaliveInterval: 15_000, keepaliveCountMax: 3, hostHash: "sha256",
      hostVerifier: (hash: string) => {
        observed = `SHA256:${Buffer.from(hash, "hex").toString("base64").replace(/=+$/, "")}`;
        const expected = profile.hostFingerprint ?? ticket.acceptedFingerprint;
        if (!expected) return false;
        const a = Buffer.from(observed), b = Buffer.from(expected);
        accepted = a.length === b.length && timingSafeEqual(a, b);
        return accepted;
      }
    };
    if (profile.authType !== "privateKey") config.password = ticket.credential.password;
    if (profile.authType !== "password") {
      config.privateKey = ticket.credential.privateKey;
      config.passphrase = ticket.credential.passphrase;
    }
    if (profile.authType === "passwordAndKey") config.authHandler = ["publickey", "password"];

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(new FileError("SFTP 连接超时, 请检查服务器是否启用 SFTP", 504)), 20_000);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket?.destroy();
        client.destroy();
        reject(error);
      };
      client.on("error", (error) => {
        if (observed && !accepted) {
          fail(profile.hostFingerprint
            ? new FileError("主机密钥已变化, 请核对服务器身份", 409, "HOST_KEY_CHANGED")
            : new FileError("请先确认服务器主机指纹", 409, "FINGERPRINT_REQUIRED", observed));
        } else fail(new FileError(error.message, 502));
      });
      client.on("close", () => {
        if (id) this.sessions.delete(id);
        fail(new FileError("SFTP 连接已关闭, 请重新连接", 502));
      });
      client.on("ready", () => {
        client.sftp((error, sftp) => {
          if (error) return fail(new FileError(`无法启动 SFTP: ${error.message}`, 502));
          sftp.realpath(".", async (pathError, home) => {
            if (pathError) return fail(new FileError(pathError.message, 502));
            try {
              if (accepted && observed && !profile.hostFingerprint) await this.profiles.trustFingerprint(profile.id, observed);
              if (settled) return;
              id = randomBytes(32).toString("base64url");
              this.sessions.set(id, { client, socket: socket!, sftp, ownerId, busy: 0, lastUsed: Date.now() });
              settled = true;
              clearTimeout(timeout);
              resolve({ sessionId: id, path: remotePath(home) });
            } catch (cause) { fail(cause as Error); }
          });
        });
      });
      try {
        socket = createConnection({ host: profile.host, port: profile.port });
        socket.on("error", () => undefined);
        client.connect({ ...config, sock: socket });
      } catch (error) { fail(error as Error); }
    });
  }

  get(id: string, ownerId: string): FileSession {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new FileError("文件连接不存在或已关闭, 请重新连接", 404);
    session.lastUsed = Date.now();
    return session;
  }

  close(id: string, ownerId: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) return false;
    this.sessions.delete(id);
    session.socket.destroy();
    session.client.destroy();
    return true;
  }

  async list(id: string, ownerId: string, path: string) {
    const session = this.get(id, ownerId);
    const canonical = await sftpCall<string>((cb) => session.sftp.realpath(path, cb));
    const entries = await sftpCall<FileEntry[]>((cb) => session.sftp.readdir(canonical, cb));
    return {
      path: canonical,
      entries: entries.filter((entry) => ![".", ".."].includes(entry.filename)).map((entry) => ({
        name: entry.filename,
        path: posix.join(canonical, entry.filename),
        type: (entry.attrs.mode & 0o170000) === 0o040000 ? "directory" : (entry.attrs.mode & 0o170000) === 0o120000 ? "link" : "file",
        size: entry.attrs.size,
        modifiedAt: entry.attrs.mtime * 1000,
        permissions: (entry.attrs.mode & 0o7777).toString(8).padStart(4, "0"),
        uid: entry.attrs.uid, gid: entry.attrs.gid
      }))
    };
  }

  async stat(id: string, ownerId: string, path: string): Promise<Stats> {
    const session = this.get(id, ownerId);
    return sftpCall<Stats>((cb) => session.sftp.stat(path, cb));
  }
}
