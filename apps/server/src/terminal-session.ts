import { timingSafeEqual } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import type { ProfileStore } from "./profile-store.js";
import type { TerminalTicket } from "./types.js";

export interface TerminalClientMessage {
  type: "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalTransport {
  send(payload: object): void;
  onMessage(listener: (message: TerminalClientMessage) => void): void;
  onClose(listener: () => void): void;
  close(code?: number, reason?: string): void;
}

function toSha256Fingerprint(hexHash: string): string {
  return `SHA256:${Buffer.from(hexHash, "hex").toString("base64").replace(/=+$/, "")}`;
}

function fingerprintsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function startTerminalSession(
  ticket: TerminalTicket,
  profileStore: ProfileStore,
  transport: TerminalTransport
): void {
  const { profile, credential } = ticket;
  console.log(`Starting SSH connection profile=${profile.id} target=${profile.host}:${profile.port}`);
  const ssh = new Client();
  let socket: Socket | undefined;
  let stream: ClientChannel | undefined;
  let observedFingerprint: string | undefined;
  let fingerprintAccepted = false;
  let connected = false;
  let failureReported = false;

  const expectedFingerprint = profile.hostFingerprint;
  const acceptedFingerprint = ticket.acceptedFingerprint;
  const config: ConnectConfig = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 15_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
    hostHash: "sha256",
    hostVerifier: (hashedKey: string) => {
      observedFingerprint = toSha256Fingerprint(hashedKey);
      if (expectedFingerprint) return fingerprintsMatch(observedFingerprint, expectedFingerprint);
      fingerprintAccepted = fingerprintsMatch(observedFingerprint, acceptedFingerprint);
      return fingerprintAccepted;
    }
  };

  if (profile.authType !== "privateKey") config.password = credential.password;
  if (profile.authType !== "password") {
    config.privateKey = credential.privateKey;
    config.passphrase = credential.passphrase;
  }
  if (profile.authType === "passwordAndKey") config.authHandler = ["publickey", "password"];

  ssh.on("ready", () => {
    connected = true;
    if (fingerprintAccepted && observedFingerprint) {
      void profileStore.trustFingerprint(profile.id, observedFingerprint).catch(() => {
        transport.send({ type: "error", message: "无法保存主机指纹, 请检查数据目录权限" });
        transport.close(1011, "Fingerprint persistence failed");
      });
    }
    ssh.shell(
      { term: "xterm-256color", cols: ticket.cols, rows: ticket.rows },
      { env: { COLORTERM: "truecolor", TERM: "xterm-256color" } },
      (error, channel) => {
        if (error) {
          transport.send({ type: "error", message: `无法启动远程终端：${error.message}` });
          transport.close(1011, "SSH shell failed");
          ssh.end();
          return;
        }
        stream = channel;
        transport.send({ type: "status", status: "connected", fingerprint: observedFingerprint });
        channel.on("data", (data: Buffer) => transport.send({ type: "output", data: data.toString("base64") }));
        channel.stderr.on("data", (data: Buffer) => transport.send({ type: "output", data: data.toString("base64") }));
        channel.on("close", () => {
          transport.send({ type: "status", status: "closed" });
          transport.close(1000, "SSH channel closed");
          ssh.end();
        });
      }
    );
  });

  ssh.on("error", (error) => {
    if (failureReported) return;
    failureReported = true;
    if (!connected && observedFingerprint && !expectedFingerprint && !fingerprintAccepted) {
      transport.send({ type: "fingerprintRequired", fingerprint: observedFingerprint });
    } else if (!connected && observedFingerprint && expectedFingerprint && !fingerprintsMatch(observedFingerprint, expectedFingerprint)) {
      transport.send({
        type: "error",
        message: `主机密钥已变化。已保存 ${expectedFingerprint}，当前 ${observedFingerprint}`
      });
    } else {
      transport.send({ type: "error", message: error.message });
    }
    transport.close(1011, "SSH connection failed");
  });

  ssh.on("close", () => {
    if (connected || failureReported) return;
    failureReported = true;
    if (observedFingerprint && !expectedFingerprint && !fingerprintAccepted) {
      transport.send({ type: "fingerprintRequired", fingerprint: observedFingerprint });
    } else {
      transport.send({ type: "error", message: "SSH 连接已关闭" });
    }
    transport.close(1011, "SSH connection closed");
  });

  transport.onMessage((message) => {
    if (message.type === "input" && typeof message.data === "string") stream?.write(message.data);
    if (
      message.type === "resize" &&
      Number.isInteger(message.cols) &&
      Number.isInteger(message.rows) &&
      message.cols! > 0 &&
      message.rows! > 0
    ) {
      stream?.setWindow(message.rows!, message.cols!, 0, 0);
    }
  });

  transport.onClose(() => {
    stream?.close();
    // Own the socket: ssh2.destroy() can be a no-op after its writable side has ended
    socket?.destroy();
    ssh.destroy();
  });

  transport.send({ type: "status", status: "connecting" });
  try {
    socket = createConnection({ host: profile.host, port: profile.port });
    socket.on("error", () => undefined);
    ssh.connect({ ...config, sock: socket });
  }
  catch (cause) {
    failureReported = true;
    transport.send({ type: "error", message: cause instanceof Error ? cause.message : "SSH 连接参数无效" });
    transport.close(1011, "Invalid SSH configuration");
  }
}
