import type { Credential, FilePreview, ProfileInput, RemoteEntry, ServerProfile } from "./types";

const apiBase = import.meta.env.BASE_URL;
let sessionTokenPromise: Promise<string> | undefined;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly fingerprint?: string) { super(message); }
}

async function readSynoToken(): Promise<string> {
  const endpoints = [
    "/webman/login.cgi",
    "/webapi/entry.cgi?api=SYNO.API.Auth&version=6&method=token"
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as {
        success?: boolean;
        SynoToken?: string;
        data?: { synotoken?: string };
      };
      const token = payload.SynoToken ?? payload.data?.synotoken;
      if (response.ok && payload.success && token) return token;
    } catch {
      // Try the next DSM session endpoint.
    }
  }
  throw new Error("无法读取 DSM 会话令牌，请从 DSM 桌面重新打开应用");
}

async function createAppSession(): Promise<string> {
  const challengeResponse = await fetch(`${apiBase}api/auth/challenge`, {
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!challengeResponse.ok) throw new Error("无法创建 DSM 身份验证请求");
  const { challenge } = await challengeResponse.json() as { challenge: string };
  const synoToken = await readSynoToken();

  const sessionResponse = await fetch(`${apiBase}api/auth/session`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Syno-Token": synoToken },
    body: JSON.stringify({ challenge })
  });
  const sessionPayload = await sessionResponse.json().catch(() => ({})) as { token?: string; error?: string };
  if (!sessionResponse.ok || !sessionPayload.token) {
    throw new Error(sessionPayload.error ?? "无法建立 DSM 应用会话");
  }
  return sessionPayload.token;
}

function getAppSession(): Promise<string> {
  if (import.meta.env.DEV) return Promise.resolve("");
  sessionTokenPromise ??= createAppSession().catch((error) => { sessionTokenPromise = undefined; throw error; });
  return sessionTokenPromise;
}

async function authorizedFetch(url: string, init?: RequestInit, retry = true): Promise<Response> {
  const sessionToken = await getAppSession();
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...init?.headers
    }
  });
  if (response.status === 401 && retry && !import.meta.env.DEV) {
    await response.body?.cancel();
    sessionTokenPromise = undefined;
    return authorizedFetch(url, init, false);
  }
  return response;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authorizedFetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; fingerprint?: string };
    throw new ApiError(body.error ?? `请求失败 (${response.status})`, response.status, body.code, body.fingerprint);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listProfiles: () => request<ServerProfile[]>(`${apiBase}api/profiles`),
  createProfile: (input: ProfileInput) =>
    request<ServerProfile>(`${apiBase}api/profiles`, { method: "POST", body: JSON.stringify(input) }),
  updateProfile: (id: string, input: ProfileInput) =>
    request<ServerProfile>(`${apiBase}api/profiles/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteProfile: (id: string) => request<void>(`${apiBase}api/profiles/${id}`, { method: "DELETE" }),
  createTicket: (
    profileId: string,
    credential: Credential,
    cols: number,
    rows: number,
    acceptedFingerprint?: string,
    useSavedCredential = false,
    purpose: "terminal" | "files" = "terminal"
  ) =>
    request<{ ticket: string }>(`${apiBase}api/terminal/tickets`, {
      method: "POST",
      body: JSON.stringify({ profileId, credential, cols, rows, acceptedFingerprint, useSavedCredential, purpose })
    }),
  terminalWebSocketUrl: (ticket: string) => {
    const url = new URL(`${apiBase}ws/terminal`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket);
    return url.toString();
  },
  createHttpTerminalSession: (ticket: string) =>
    request<{ sessionId: string }>(`${apiBase}api/terminal/http-sessions`, {
      method: "POST",
      body: JSON.stringify({ ticket })
    }),
  pollHttpTerminalEvents: (sessionId: string, signal: AbortSignal) =>
    request<{
      events: Array<{
        type: string;
        data?: string;
        status?: string;
        message?: string;
        fingerprint?: string;
      }>;
      closed: boolean;
    }>(`${apiBase}api/terminal/http-sessions/${encodeURIComponent(sessionId)}/events`, { signal }),
  sendHttpTerminalMessage: (
    sessionId: string,
    message: { type: "input"; data: string } | { type: "resize"; cols: number; rows: number }
  ) => request<void>(`${apiBase}api/terminal/http-sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify(message)
  }),
  closeHttpTerminalSession: (sessionId: string) =>
    request<void>(`${apiBase}api/terminal/http-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  createFileSession: (ticket: string) => request<{ sessionId: string; path: string }>(`${apiBase}api/files/sessions`, {
    method: "POST", body: JSON.stringify({ ticket })
  }),
  closeFileSession: (id: string) => request<void>(`${apiBase}api/files/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listFiles: (id: string, path: string) => request<{ path: string; entries: RemoteEntry[] }>(`${apiBase}api/files/sessions/${encodeURIComponent(id)}/entries?path=${encodeURIComponent(path)}`),
  fileOperation: (id: string, body: { operation: string; path: string; destination?: string; mode?: string }) =>
    request<void>(`${apiBase}api/files/sessions/${encodeURIComponent(id)}/operations`, { method: "POST", body: JSON.stringify(body) }),
  previewFile: (id: string, path: string, signal?: AbortSignal) => request<FilePreview>(`${apiBase}api/files/sessions/${encodeURIComponent(id)}/preview?path=${encodeURIComponent(path)}`, { signal }),
  downloadFile: async (id: string, path: string) => {
    const { token } = await request<{ token: string }>(`${apiBase}api/files/sessions/${encodeURIComponent(id)}/download`, { method: "POST", body: JSON.stringify({ path }) });
    const link = document.createElement("a");
    link.href = `${apiBase}api/files/download/${encodeURIComponent(token)}`;
    link.rel = "noreferrer";
    link.download = path.split("/").pop() ?? "download";
    document.body.append(link);
    link.click();
    link.remove();
  },
  uploadFile: async (id: string, path: string, file: File, overwrite: boolean, signal: AbortSignal, progress: (sent: number) => void) => {
    const token = await getAppSession();
    if (signal.aborted) throw new DOMException("已取消", "AbortError");
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBase}api/files/sessions/${encodeURIComponent(id)}/upload?path=${encodeURIComponent(path)}&overwrite=${overwrite}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (event) => progress(event.loaded);
      const abort = () => xhr.abort();
      const clean = () => signal.removeEventListener("abort", abort);
      xhr.onload = () => {
        clean();
        if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
        let body: { error?: string; code?: string } = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* Proxy responses may not be JSON */ }
        if (xhr.status === 401) sessionTokenPromise = undefined;
        reject(new ApiError(body.error ?? `上传失败 (${xhr.status})`, xhr.status, body.code));
      };
      xhr.onerror = () => { clean(); reject(new Error("上传连接中断, 请重试")); };
      xhr.onabort = () => { clean(); reject(new DOMException("已取消", "AbortError")); };
      xhr.timeout = 30 * 60_000;
      xhr.ontimeout = () => { clean(); reject(new Error("上传超时, 请重试")); };
      signal.addEventListener("abort", abort, { once: true });
      xhr.send(file);
    });
  }
};
