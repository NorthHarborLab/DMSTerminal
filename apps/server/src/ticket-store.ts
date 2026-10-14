import { randomBytes } from "node:crypto";
import type { TerminalTicket } from "./types.js";

const TICKET_TTL_MS = 30_000;

export class TicketStore {
  private readonly tickets = new Map<string, TerminalTicket>();

  issue(ticket: Omit<TerminalTicket, "expiresAt">): string {
    this.prune();
    const token = randomBytes(32).toString("base64url");
    this.tickets.set(token, { ...ticket, expiresAt: Date.now() + TICKET_TTL_MS });
    return token;
  }

  consume(token: string, purpose: TerminalTicket["purpose"], ownerId?: string): TerminalTicket | undefined {
    const ticket = this.tickets.get(token);
    if (ticket && (ticket.purpose !== purpose || (ownerId && ticket.ownerId !== ownerId))) return undefined;
    this.tickets.delete(token);
    if (!ticket || ticket.expiresAt < Date.now()) return undefined;
    return ticket;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, ticket] of this.tickets) {
      if (ticket.expiresAt < now) this.tickets.delete(token);
    }
  }
}
