import { z } from "zod";

export const terminalMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string().max(64 * 1024) }),
  z.object({ type: z.literal("resize"), cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(500) })
]);
