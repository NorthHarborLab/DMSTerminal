import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "./api";
import type { TerminalSession } from "./types";
import { terminalTheme, type ThemeColors } from "./themes";

type ConnectionState = "connecting" | "connected" | "closed" | "error";
type ClientMessage = { type: "input"; data: string } | { type: "resize"; cols: number; rows: number };
type WebSocketOutcome = "ended" | "fallback" | "cancelled";

const WEBSOCKET_OPEN_TIMEOUT_MS = 8_000;

interface ServerMessage {
  type: string;
  data?: string;
  status?: string;
  message?: string;
  fingerprint?: string;
}

interface WebSocketConnection {
  mode: "websocket";
  socket: WebSocket;
}

interface HttpConnection {
  mode: "http";
  sessionId: string;
  controller: AbortController;
}

type TerminalConnection = WebSocketConnection | HttpConnection;

interface Props {
  session: TerminalSession;
  active: boolean;
  onStatus: (state: ConnectionState) => void;
  theme: ThemeColors;
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function TerminalPane({ session, active, onStatus, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const connectionRef = useRef<TerminalConnection | undefined>(undefined);
  const connectionSequenceRef = useRef(0);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sendRef = useRef<(message: ClientMessage) => void>(() => undefined);
  const [fingerprint, setFingerprint] = useState<string>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const acceptedFingerprintRef = useRef<string | undefined>(undefined);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const closeCurrentConnection = useCallback(() => {
    connectionSequenceRef.current += 1;
    const connection = connectionRef.current;
    connectionRef.current = undefined;
    sendQueueRef.current = Promise.resolve();
    if (!connection) return;
    if (connection.mode === "websocket") {
      if (
        connection.socket.readyState === WebSocket.CONNECTING ||
        connection.socket.readyState === WebSocket.OPEN
      ) {
        connection.socket.close(1000, "Terminal session closed");
      }
      return;
    }
    connection.controller.abort();
    void api.closeHttpTerminalSession(connection.sessionId).catch(() => undefined);
  }, []);

  sendRef.current = (message) => {
    const connection = connectionRef.current;
    if (!connection) return;
    if (connection.mode === "websocket") {
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(JSON.stringify(message));
      }
      return;
    }
    sendQueueRef.current = sendQueueRef.current
      .then(async () => {
        if (connectionRef.current !== connection || connection.controller.signal.aborted) return;
        await api.sendHttpTerminalMessage(connection.sessionId, message);
      })
      .catch((cause) => {
        if (connectionRef.current !== connection || connection.controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "无法向终端发送数据");
        onStatusRef.current("error");
      });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.18,
      scrollback: 10_000,
      minimumContrastRatio: 4.5,
      theme: terminalTheme(theme)
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;
    requestAnimationFrame(() => fit.fit());

    let inputBuffer = "";
    let inputTimer: number | undefined;
    const flushInput = () => {
      inputTimer = undefined;
      if (!inputBuffer) return;
      sendRef.current({ type: "input", data: inputBuffer });
      inputBuffer = "";
    };
    const input = terminal.onData((data) => {
      inputBuffer += data;
      inputTimer ??= window.setTimeout(flushInput, 20);
    });
    const resize = terminal.onResize(({ cols, rows }) => sendRef.current({ type: "resize", cols, rows }));
    const observer = new ResizeObserver(() => requestAnimationFrame(() => fit.fit()));
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      if (inputTimer !== undefined) window.clearTimeout(inputTimer);
      closeCurrentConnection();
      terminal.dispose();
    };
  }, [closeCurrentConnection]);

  const connect = useCallback(async () => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    closeCurrentConnection();
    const sequence = connectionSequenceRef.current;
    setError(undefined);
    setFingerprint(undefined);
    onStatusRef.current("connecting");
    terminal.write("\r\n\x1b[38;5;244m正在建立安全连接…\x1b[0m\r\n");
    fit.fit();

    try {
      const handleMessage = (message: ServerMessage): boolean => {
        if (message.type === "output" && message.data) terminal.write(decodeBase64(message.data));
        if (message.type === "status" && message.status === "connected") onStatusRef.current("connected");
        if (message.type === "status" && message.status === "closed") {
          onStatusRef.current("closed");
          return true;
        }
        if (message.type === "fingerprintRequired" && message.fingerprint) {
          setFingerprint(message.fingerprint);
          onStatusRef.current("closed");
          return true;
        }
        if (message.type === "error") {
          setError(message.message ?? "SSH 连接失败");
          onStatusRef.current("error");
          return true;
        }
        return false;
      };

      const createTicket = () => api.createTicket(
        session.profile.id,
        session.credential,
        terminal.cols,
        terminal.rows,
        acceptedFingerprintRef.current,
        session.useSavedCredential
      );

      const { ticket } = await createTicket();
      if (sequence !== connectionSequenceRef.current) return;

      const webSocketOutcome = await new Promise<WebSocketOutcome>((resolve) => {
        const socket = new WebSocket(api.terminalWebSocketUrl(ticket));
        const connection: WebSocketConnection = { mode: "websocket", socket };
        connectionRef.current = connection;
        let settled = false;

        const closeSocket = (reason: string) => {
          if (socket.readyState !== WebSocket.CONNECTING && socket.readyState !== WebSocket.OPEN) return;
          try {
            socket.close(1000, reason);
          } catch {
            // The connection is already being closed by the browser.
          }
        };
        const finish = (outcome: WebSocketOutcome) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(openTimeout);
          socket.onopen = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;
          if (connectionRef.current === connection) connectionRef.current = undefined;
          resolve(outcome);
        };
        const fallback = () => {
          closeSocket("Use HTTP fallback");
          finish(sequence === connectionSequenceRef.current ? "fallback" : "cancelled");
        };
        const openTimeout = window.setTimeout(fallback, WEBSOCKET_OPEN_TIMEOUT_MS);

        socket.onopen = () => window.clearTimeout(openTimeout);
        socket.onmessage = (event) => {
          if (sequence !== connectionSequenceRef.current) {
            closeSocket("Connection superseded");
            finish("cancelled");
            return;
          }
          try {
            if (handleMessage(JSON.parse(String(event.data)) as ServerMessage)) {
              closeSocket("Terminal session ended");
              finish("ended");
            }
          } catch {
            fallback();
          }
        };
        socket.onerror = fallback;
        socket.onclose = () => finish(sequence === connectionSequenceRef.current ? "fallback" : "cancelled");
      });

      if (webSocketOutcome !== "fallback" || sequence !== connectionSequenceRef.current) return;
      onStatusRef.current("connecting");
      terminal.write("\r\n\x1b[38;5;214mWebSocket 不可用，正在切换到 HTTP 事件通道…\x1b[0m\r\n");

      const { ticket: fallbackTicket } = await createTicket();
      if (sequence !== connectionSequenceRef.current) return;
      const { sessionId } = await api.createHttpTerminalSession(fallbackTicket);
      if (sequence !== connectionSequenceRef.current) {
        void api.closeHttpTerminalSession(sessionId).catch(() => undefined);
        return;
      }

      const controller = new AbortController();
      const connection: HttpConnection = { mode: "http", sessionId, controller };
      connectionRef.current = connection;
      let terminalEnded = false;

      while (!controller.signal.aborted) {
        const payload = await api.pollHttpTerminalEvents(sessionId, controller.signal);
        for (const message of payload.events) terminalEnded = handleMessage(message) || terminalEnded;
        if (payload.closed) break;
      }

      if (connectionRef.current === connection) {
        connectionRef.current = undefined;
        sendQueueRef.current = Promise.resolve();
        if (!controller.signal.aborted && !terminalEnded) {
          setError("终端数据流意外中断");
          onStatusRef.current("error");
        }
      }
    } catch (cause) {
      if (sequence !== connectionSequenceRef.current || (cause instanceof DOMException && cause.name === "AbortError")) return;
      connectionRef.current = undefined;
      sendQueueRef.current = Promise.resolve();
      setError(cause instanceof Error ? cause.message : "连接失败");
      onStatusRef.current("error");
    }
  }, [closeCurrentConnection, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => void connect(), 0);
    return () => window.clearTimeout(timer);
  }, [attempt, connect]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => fitRef.current?.fit());
  }, [active]);

  function trustAndReconnect() {
    if (!fingerprint) return;
    acceptedFingerprintRef.current = fingerprint;
    closeCurrentConnection();
    setAttempt((value) => value + 1);
  }

  function reconnect() {
    closeCurrentConnection();
    setAttempt((value) => value + 1);
  }

  return (
    <section className={`terminal-pane ${active ? "active" : ""}`} aria-hidden={!active}>
      <div ref={containerRef} className="terminal-canvas" />
      {fingerprint && (
        <div className="terminal-notice">
          <span className="notice-icon">⌁</span>
          <div>
            <strong>确认服务器身份</strong>
            <p>这是首次连接。请与服务器管理员核对 SHA256 指纹：</p>
            <code>{fingerprint}</code>
            <div className="notice-actions">
              <button className="button primary" onClick={trustAndReconnect}>信任并连接</button>
            </div>
          </div>
        </div>
      )}
      {error && !fingerprint && (
        <div className="terminal-notice error-notice">
          <span className="notice-icon">!</span>
          <div>
            <strong>连接失败</strong>
            <p>{error}</p>
            <div className="notice-actions">
              <button className="button secondary" onClick={reconnect}>重新连接</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
