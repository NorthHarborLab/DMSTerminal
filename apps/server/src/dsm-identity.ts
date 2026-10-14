import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import type { Request } from "express";

export interface DsmIdentity { username: string; uid: string }
export interface DsmAuthContext { cookie: string; synoToken: string; remoteAddress: string; serverAddress: string; secure: boolean }
export type DsmIdentityVerifier = (context: DsmAuthContext) => Promise<DsmIdentity | undefined>;

async function executable(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try { await access(path, constants.X_OK); return path; } catch { /* Try the next fixed system path */ }
  }
  return undefined;
}

export function readDsmAuthContext(request: Request): DsmAuthContext | undefined {
  const cookie = request.headers.cookie;
  const synoToken = request.get("X-Syno-Token");
  if (!cookie || cookie.length > 8192 || /[\x00-\x1f\x7f]/.test(cookie)) return undefined;
  if (!synoToken || synoToken.length > 4096 || /[\x00-\x20\x7f]/.test(synoToken)) return undefined;
  return { cookie, synoToken, remoteAddress: request.ip ?? request.socket.remoteAddress ?? "",
    serverAddress: request.get("X-DSM-Server-Addr") ?? request.socket.localAddress ?? "", secure: request.secure };
}

type Runner = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
const run: Runner = (file, args, env) => new Promise((resolve, reject) => {
  execFile(file, args, { env, timeout: 3000, maxBuffer: 4096, encoding: "utf8", windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(stdout));
});

// Local tests inject dependencies, never HTTP input or executable-path environment overrides
export function createDsmIdentityVerifier(dependencies = { executable, run }): DsmIdentityVerifier {
  return async (context) => {
    try {
      const auth = await dependencies.executable([
        "/usr/syno/synoman/webman/modules/authenticate.cgi", "/usr/syno/synoman/webman/authenticate.cgi"
      ]);
      const id = await dependencies.executable(["/usr/bin/id", "/bin/id"]);
      if (!auth || !id) return undefined;
      const env: NodeJS.ProcessEnv = {
        PATH: "/usr/bin:/bin", LANG: "C", REQUEST_METHOD: "GET", GATEWAY_INTERFACE: "CGI/1.1",
        SERVER_PROTOCOL: "HTTP/1.1", HTTP_COOKIE: context.cookie, HTTP_X_SYNO_TOKEN: context.synoToken,
        QUERY_STRING: new URLSearchParams({ SynoToken: context.synoToken }).toString(),
        REMOTE_ADDR: context.remoteAddress, SERVER_ADDR: context.serverAddress, HTTPS: context.secure ? "on" : "off"
      };
      const username = (await dependencies.run(auth, [], env)).replace(/\r?\n$/, "");
      if (!username || username.length > 256 || /[\x00-\x1f\x7f]/.test(username)) return undefined;
      const uid = (await dependencies.run(id, ["-u", "--", username], { PATH: "/usr/bin:/bin", LANG: "C" })).trim();
      return /^\d{1,10}$/.test(uid) ? { username, uid } : undefined;
    } catch { return undefined; }
  };
}

export const verifyDsmIdentity = createDsmIdentityVerifier();
