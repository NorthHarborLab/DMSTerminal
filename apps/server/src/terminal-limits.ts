export class TerminalLimitError extends Error {
  readonly status = 429;
  readonly code = "TERMINAL_LIMIT";
  constructor() { super("终端连接数量达到上限, 请先关闭其他终端"); }
}

export class TerminalLimits {
  private total = 0;
  private readonly owners = new Map<string, number>();
  constructor(private readonly perOwner = 8, private readonly global = 64) {}

  acquire(ownerId: string): () => void {
    const count = this.owners.get(ownerId) ?? 0;
    if (count >= this.perOwner || this.total >= this.global) throw new TerminalLimitError();
    this.owners.set(ownerId, count + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const remaining = (this.owners.get(ownerId) ?? 1) - 1;
      if (remaining) this.owners.set(ownerId, remaining);
      else this.owners.delete(ownerId);
    };
  }
}
