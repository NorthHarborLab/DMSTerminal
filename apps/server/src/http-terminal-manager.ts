import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type { ProfileStore } from "./profile-store.js";
import type { TicketStore } from "./ticket-store.js";
import { TerminalLimits } from "./terminal-limits.js";
import {
  startTerminalSession,
  type TerminalClientMessage,
  type TerminalTransport
} from "./terminal-session.js";

const MAX_QUEUED_BYTES = 1024 * 1024;
const CLIENT_ATTACH_TIMEOUT_MS = 30_000;
const CLOSED_SESSION_RETENTION_MS = 30_000;
const POLL_TIMEOUT_MS = 10_000;
const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

type TransportMode = "poll" | "stream";

export interface HttpTerminalTiming { attachMs: number; leaseMs: number; pollMs: number; retentionMs: number }
const DEFAULT_TIMING: HttpTerminalTiming = { attachMs: CLIENT_ATTACH_TIMEOUT_MS, leaseMs: 30_000, pollMs: POLL_TIMEOUT_MS, retentionMs: CLOSED_SESSION_RETENTION_MS };

export class HttpTerminalTransport implements TerminalTransport {
  private mode?: TransportMode;
  private streamResponse?: Response;
  private pollResponse?: Response;
  private queuedEvents: object[] = [];
  private queuedBytes = 0;
  private messageListener?: (message: TerminalClientMessage) => void;
  private closeListener?: () => void;
  private closed = false;
  private finished = false;
  private heartbeat?: NodeJS.Timeout;
  private pollTimeout?: NodeJS.Timeout;
  private lifecycleTimeout?: NodeJS.Timeout;

  constructor(private readonly onFinished: () => void, private readonly timing = DEFAULT_TIMING,
    private readonly onClosed: () => void = () => undefined) {
    this.lifecycleTimeout = setTimeout(() => this.dispose(), timing.attachMs);
    this.lifecycleTimeout.unref();
  }

  attachStream(response: Response): boolean {
    if (this.finished || this.streamResponse || this.mode === "poll") return false;
    response.once("error", () => this.dispose());
    this.mode = "stream";
    this.streamResponse = response;
    clearTimeout(this.lifecycleTimeout);
    this.lifecycleTimeout = undefined;

    response.status(200);
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    for (const event of this.queuedEvents) response.write(`${JSON.stringify(event)}\n`);
    this.clearQueue();

    if (this.closed) {
      response.end();
      this.finish();
      return true;
    }

    this.heartbeat = setInterval(() => {
      if (!this.closed && !response.writableEnded) this.send({ type: "heartbeat" });
    }, STREAM_HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();

    response.on("close", () => {
      if (!response.writableEnded) this.dispose();
    });
    return true;
  }

  poll(response: Response): boolean {
    if (this.finished || this.pollResponse || this.mode === "stream") return false;
    response.once("error", () => this.dispose());
    this.mode = "poll";
    this.renewLease();
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    if (this.queuedEvents.length > 0 || this.closed) {
      this.respondToPoll(response);
      if (this.closed) this.scheduleClosedFinish();
      return true;
    }

    this.pollResponse = response;
    this.pollTimeout = setTimeout(() => {
      if (this.pollResponse === response) this.respondToPoll(response);
    }, this.timing.pollMs);
    this.pollTimeout.unref();
    response.on("close", () => {
      if (this.pollResponse !== response) return;
      this.pollResponse = undefined;
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
      this.renewLease();
    });
    return true;
  }

  receive(message: TerminalClientMessage): boolean {
    if (this.closed || !this.messageListener) return false;
    this.messageListener(message);
    return true;
  }

  send(payload: object): void {
    if (this.closed) return;
    if (this.mode === "stream" && this.streamResponse && !this.streamResponse.writableEnded) {
      const data = `${JSON.stringify(payload)}\n`;
      if (this.streamResponse.writableLength + Buffer.byteLength(data) > MAX_QUEUED_BYTES) { this.dispose(); return; }
      this.streamResponse.write(data);
      return;
    }

    this.queuedEvents.push(payload);
    this.queuedBytes += Buffer.byteLength(JSON.stringify(payload));
    if (this.queuedBytes > MAX_QUEUED_BYTES) {
      this.close();
      return;
    }
    if (this.pollResponse) this.respondToPoll(this.pollResponse);
  }

  onMessage(listener: (message: TerminalClientMessage) => void): void {
    this.messageListener = listener;
  }

  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed();
    clearInterval(this.heartbeat);
    this.closeListener?.();

    if (this.mode === "stream" && this.streamResponse) {
      if (!this.streamResponse.writableEnded) this.streamResponse.end();
      this.finish();
      return;
    }

    if (this.mode === "poll") {
      if (this.pollResponse) this.respondToPoll(this.pollResponse);
      this.scheduleClosedFinish();
    }
  }

  dispose(): void {
    if (!this.closed) {
      this.closed = true;
      this.closeListener?.();
    }
    if (this.pollResponse && !this.pollResponse.writableEnded) {
      this.pollResponse.json({ events: this.takeEvents(), closed: true });
      this.pollResponse = undefined;
    }
    if (this.streamResponse && !this.streamResponse.writableEnded) this.streamResponse.end();
    this.finish();
  }

  private respondToPoll(response: Response): void {
    if (this.pollResponse === response) this.pollResponse = undefined;
    clearTimeout(this.pollTimeout);
    this.pollTimeout = undefined;
    this.renewLease();
    if (!response.writableEnded) response.json({ events: this.takeEvents(), closed: this.closed });
  }

  private takeEvents(): object[] {
    const events = this.queuedEvents;
    this.clearQueue();
    return events;
  }

  private clearQueue(): void {
    this.queuedEvents = [];
    this.queuedBytes = 0;
  }

  private scheduleClosedFinish(): void {
    clearTimeout(this.lifecycleTimeout);
    this.lifecycleTimeout = setTimeout(() => this.finish(), this.timing.retentionMs);
    this.lifecycleTimeout.unref();
  }

  private renewLease(): void {
    if (this.closed || this.finished) return;
    clearTimeout(this.lifecycleTimeout);
    this.lifecycleTimeout = setTimeout(() => this.dispose(), this.timing.leaseMs);
    this.lifecycleTimeout.unref();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.lifecycleTimeout);
    clearTimeout(this.pollTimeout);
    clearInterval(this.heartbeat);
    this.onFinished();
  }
}

export class HttpTerminalManager {
  private readonly sessions = new Map<string, HttpTerminalTransport>();
  private readonly owners = new Map<string, string>();
  private readonly closed = new Set<string>();

  constructor(
    private readonly profileStore: ProfileStore,
    private readonly ticketStore: TicketStore,
    private readonly limits: TerminalLimits,
    private readonly timing = DEFAULT_TIMING
  ) {}

  create(ticketToken: string, ownerId: string): string | undefined {
    const ticket = this.ticketStore.consume(ticketToken, "terminal", ownerId);
    if (!ticket) return undefined;
    const release = this.limits.acquire(ownerId);
    const sessionId = randomBytes(32).toString("base64url");
    const transport = new HttpTerminalTransport(() => {
      this.sessions.delete(sessionId);
      this.owners.delete(sessionId);
      this.closed.delete(sessionId);
      release();
    }, this.timing, () => { release(); this.retainClosed(sessionId, ownerId); });
    this.sessions.set(sessionId, transport);
    this.owners.set(sessionId, ownerId);
    startTerminalSession(ticket, this.profileStore, transport);
    return sessionId;
  }

  private retainClosed(sessionId: string, ownerId: string): void {
    this.closed.add(sessionId);
    const owned = [...this.closed].filter((id) => this.owners.get(id) === ownerId);
    while (owned.length > 8) this.sessions.get(owned.shift()!)?.dispose();
    while (this.closed.size > 64) this.sessions.get(this.closed.values().next().value!)?.dispose();
  }

  attachStream(sessionId: string, response: Response): boolean {
    if (this.owners.get(sessionId) !== response.locals.dsmUser) return false;
    return this.sessions.get(sessionId)?.attachStream(response) ?? false;
  }

  poll(sessionId: string, response: Response): boolean {
    if (this.owners.get(sessionId) !== response.locals.dsmUser) return false;
    return this.sessions.get(sessionId)?.poll(response) ?? false;
  }

  receive(sessionId: string, message: TerminalClientMessage, ownerId: string): boolean {
    if (this.owners.get(sessionId) !== ownerId) return false;
    return this.sessions.get(sessionId)?.receive(message) ?? false;
  }

  close(sessionId: string, ownerId: string): boolean {
    if (this.owners.get(sessionId) !== ownerId) return false;
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.dispose();
    return true;
  }
}
