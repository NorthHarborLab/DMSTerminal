import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ProfileStore } from "./profile-store.js";
import type { TicketStore } from "./ticket-store.js";
import type { TerminalTicket } from "./types.js";
import { TerminalLimits } from "./terminal-limits.js";
import { terminalMessageSchema } from "./terminal-messages.js";
import {
  startTerminalSession,
  type TerminalClientMessage,
  type TerminalTransport
} from "./terminal-session.js";

const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 20_000;

interface HeartbeatWebSocket extends WebSocket {
  isAlive: boolean;
}

function createWebSocketTransport(ws: WebSocket): TerminalTransport {
  return {
    send(payload) {
      if (ws.readyState !== WebSocket.OPEN) return;
      const data = JSON.stringify(payload);
      if (ws.bufferedAmount + Buffer.byteLength(data) > 1024 * 1024) { ws.terminate(); return; }
      ws.send(data, (error) => { if (error) ws.terminate(); });
    },
    onMessage(listener) {
      ws.on("message", (raw) => {
        try {
          const message = terminalMessageSchema.safeParse(JSON.parse(raw.toString()));
          if (!message.success) { ws.close(1008, "Invalid terminal message"); return; }
          listener(message.data);
        } catch {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", message: "收到无效的终端消息" }));
          }
        }
      });
    },
    onClose(listener) {
      ws.on("close", listener);
    },
    close(code = 1000, reason = "Terminal session closed") {
      if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
    }
  };
}

export function createTerminalGateway(profileStore: ProfileStore, ticketStore: TicketStore, limits: TerminalLimits): WebSocketServer {
  const accepted = new WeakMap<IncomingMessage, { ticket: TerminalTicket; release: () => void }>();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 512 * 1024,
    verifyClient(info, done) {
      const url = new URL(info.req.url ?? "/", "http://localhost");
      const token = url.searchParams.get("ticket");
      const ticket = token ? ticketStore.consume(token, "terminal") : undefined;
      if (!ticket) { done(false, 401, "Invalid terminal ticket"); return; }
      try {
        const release = limits.acquire(ticket.ownerId);
        accepted.set(info.req, { ticket, release });
        info.req.socket.once("close", release);
        done(true);
      } catch { done(false, 429, "Terminal limit reached"); }
    }
  });

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    ws.on("error", () => ws.terminate());
    const admission = accepted.get(request);
    accepted.delete(request);
    if (!admission) { ws.terminate(); return; }
    ws.once("close", admission.release);
    const heartbeatWebSocket = ws as HeartbeatWebSocket;
    heartbeatWebSocket.isAlive = true;
    heartbeatWebSocket.on("pong", () => {
      heartbeatWebSocket.isAlive = true;
    });

    startTerminalSession(admission.ticket, profileStore, createWebSocketTransport(ws));
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as HeartbeatWebSocket;
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, WEBSOCKET_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
