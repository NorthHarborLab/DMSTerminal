import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Express, Response } from "express";
import type { Stats } from "ssh2";
import { FileError, remotePath, sftpCall, type SftpManager } from "./sftp-manager.js";

const UPLOAD_LIMIT = 1024 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 256 * 1024;
const IMAGE_PREVIEW_LIMIT = 8 * 1024 * 1024;
const rasterTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

interface DownloadTicket { sessionId: string; ownerId: string; path: string; expiresAt: number }
const downloads = new Map<string, DownloadTicket>();

function owner(response: Response): string { return response.locals.dsmUser as string; }

export function installDownloadRoute(app: Express, files: SftpManager): void {
  app.get("/api/files/download/:token", async (request, response) => {
    const ticket = downloads.get(request.params.token);
    downloads.delete(request.params.token);
    if (!ticket || ticket.expiresAt < Date.now()) throw new FileError("下载链接已失效, 请重新点击下载", 410);
    const session = files.get(ticket.sessionId, ticket.ownerId);
    const attrs = await files.stat(ticket.sessionId, ticket.ownerId, ticket.path);
    if (!attrs.isFile()) throw new FileError("只能下载普通文件");
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Length", attrs.size);
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(posix.basename(ticket.path)).replace(/'/g, "%27")}`);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    session.busy++;
    try { await pipeline(session.sftp.createReadStream(ticket.path), response); }
    finally { session.busy--; session.lastUsed = Date.now(); }
  });
}

export function installFileRoutes(app: Express, files: SftpManager): void {
  app.post("/api/files/sessions", async (request, response) => {
    if (typeof request.body?.ticket !== "string") throw new FileError("缺少文件连接凭证");
    const result = await files.create(request.body.ticket, owner(response));
    if (response.destroyed) { files.close(result.sessionId, owner(response)); return; }
    response.status(201).json(result);
  });
  app.delete("/api/files/sessions/:id", (request, response) => {
    files.get(request.params.id, owner(response));
    files.close(request.params.id, owner(response));
    response.status(204).end();
  });
  app.get("/api/files/sessions/:id/entries", async (request, response) => {
    response.json(await files.list(request.params.id, owner(response), remotePath(request.query.path)));
  });
  app.post("/api/files/sessions/:id/operations", async (request, response) => {
    const session = files.get(request.params.id, owner(response));
    const path = remotePath(request.body?.path);
    if (path === "/") throw new FileError("不允许修改根目录");
    switch (request.body?.operation) {
      case "mkdir":
        await sftpCall<void>((cb) => session.sftp.mkdir(path, { mode: 0o755 }, cb));
        break;
      case "rename": {
        const destination = remotePath(request.body.destination);
        if (destination === "/" || destination === path) throw new FileError("请输入不同的目标路径");
        let exists = true;
        try { await sftpCall<Stats>((cb) => session.sftp.lstat(destination, cb)); }
        catch (error) { if ((error as { code?: number }).code !== 2) throw error; exists = false; }
        if (exists) throw new FileError("目标名称已存在, 请使用其他名称", 409);
        await sftpCall<void>((cb) => session.sftp.rename(path, destination, cb));
        break;
      }
      case "delete": {
        const attrs = await sftpCall<Stats>((cb) => session.sftp.lstat(path, cb));
        if (attrs.isDirectory()) await sftpCall<void>((cb) => session.sftp.rmdir(path, cb));
        else await sftpCall<void>((cb) => session.sftp.unlink(path, cb));
        break;
      }
      case "chmod": {
        if (typeof request.body.mode !== "string" || !/^[0-7]{3,4}$/.test(request.body.mode)) throw new FileError("权限需为 3 或 4 位八进制数字");
        await sftpCall<void>((cb) => session.sftp.chmod(path, Number.parseInt(request.body.mode, 8), cb));
        break;
      }
      default: throw new FileError("不支持的文件操作");
    }
    response.status(204).end();
  });
  app.post("/api/files/sessions/:id/download", async (request, response) => {
    files.get(request.params.id, owner(response));
    const path = remotePath(request.body?.path);
    for (const [token, ticket] of downloads) if (ticket.expiresAt < Date.now()) downloads.delete(token);
    if (downloads.size >= 1024) throw new FileError("下载请求过多, 请稍后重试", 429);
    const token = randomBytes(32).toString("base64url");
    downloads.set(token, { sessionId: request.params.id, ownerId: owner(response), path, expiresAt: Date.now() + 30_000 });
    response.json({ token });
  });
  app.get("/api/files/sessions/:id/preview", async (request, response) => {
    const session = files.get(request.params.id, owner(response));
    const path = remotePath(request.query.path);
    const attrs = await files.stat(request.params.id, owner(response), path);
    if (!attrs.isFile()) throw new FileError("目录和特殊文件不支持预览");
    const mime = rasterTypes[posix.extname(path).toLowerCase()];
    if (mime && attrs.size > IMAGE_PREVIEW_LIMIT) throw new FileError("图片超过 8 MiB, 请下载后查看", 413);
    const limit = mime ? IMAGE_PREVIEW_LIMIT : TEXT_PREVIEW_LIMIT;
    const chunks: Buffer[] = [];
    session.busy++;
    try {
      if (attrs.size > 0) for await (const chunk of session.sftp.createReadStream(path, { start: 0, end: Math.min(attrs.size, limit) - 1 })) chunks.push(Buffer.from(chunk));
    } finally { session.busy--; session.lastUsed = Date.now(); }
    const data = Buffer.concat(chunks);
    if (mime) {
      const valid = mime === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === "image/jpeg" ? data[0] === 255 && data[1] === 216
        : mime === "image/gif" ? /^GIF8[79]a/.test(data.subarray(0, 6).toString())
        : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP";
      if (!valid) throw new FileError("文件内容不是受支持的图片, 请下载后查看", 415);
      return response.json({ type: "image", mime, data: data.toString("base64"), size: attrs.size, truncated: false });
    }
    if (data.includes(0)) throw new FileError("二进制文件不支持文本预览, 请下载后查看", 415);
    response.json({ type: "text", text: data.toString("utf8"), size: attrs.size, truncated: attrs.size > limit });
  });
  app.post("/api/files/sessions/:id/upload", async (request, response) => {
    const session = files.get(request.params.id, owner(response));
    const path = remotePath(request.query.path);
    if (path === "/") throw new FileError("请选择文件名称");
    const size = Number(request.headers["content-length"] ?? 0);
    if (size > UPLOAD_LIMIT) throw new FileError("单个文件不能超过 1 GiB", 413);
    let exists = true;
    let existingAttrs: Stats | undefined;
    try { existingAttrs = await sftpCall<Stats>((cb) => session.sftp.lstat(path, cb)); }
    catch (error) { if ((error as { code?: number }).code !== 2) throw error; exists = false; }
    if (exists && request.query.overwrite !== "true") throw new FileError("同名文件已存在, 请确认覆盖", 409, "FILE_EXISTS");
    if (existingAttrs && !existingAttrs.isFile()) throw new FileError("不能覆盖目录、符号链接或特殊文件", 409);
    const temporary = posix.join(posix.dirname(path), `.dsm-terminal-upload-${randomBytes(16).toString("hex")}`);
    let received = 0;
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > UPLOAD_LIMIT ? new FileError("单个文件不能超过 1 GiB", 413) : null, chunk);
    } });
    session.busy++;
    try {
      await pipeline(request, limiter, session.sftp.createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      if (existingAttrs) await sftpCall<void>((cb) => session.sftp.chmod(temporary, existingAttrs!.mode & 0o777, cb));
      if (exists) {
        try { await sftpCall<void>((cb) => session.sftp.ext_openssh_rename(temporary, path, cb)); }
        catch (renameError) {
          if ((renameError as { code?: number }).code !== 8 && !(renameError as Error).message.includes("does not support")) throw renameError;
          const backup = `${temporary}.previous`;
          await sftpCall<void>((cb) => session.sftp.rename(path, backup, cb));
          try { await sftpCall<void>((cb) => session.sftp.rename(temporary, path, cb)); }
          catch (error) {
            try { await sftpCall<void>((cb) => session.sftp.rename(backup, path, cb)); }
            catch { throw new FileError(`上传失败, 原文件保留在 ${backup}, 请手动恢复`, 502); }
            throw error;
          }
          await sftpCall<void>((cb) => session.sftp.unlink(backup, cb));
        }
      } else await sftpCall<void>((cb) => session.sftp.rename(temporary, path, cb));
      response.status(201).json({ path, size: received });
    } catch (error) {
      await sftpCall<void>((cb) => session.sftp.unlink(temporary, cb)).catch(() => undefined);
      throw error;
    } finally { session.busy--; session.lastUsed = Date.now(); }
  });
}
