import { readFile } from "node:fs/promises";
import { z } from "zod";

const accessSchema = z.object({ externalUrl: z.string().max(2048) }).strict();

export function parseExternalOrigin(value: string): string {
  try {
    if (value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value) || !/^https:\/\/[^/?#]+\/?$/i.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || url.hostname.includes("*") || value.includes("\\")) throw new Error();
    return url.origin;
  } catch {
    throw new Error("外部访问地址必须是明确的 HTTPS 来源, 仅包含协议、主机和可选端口");
  }
}

export async function loadExternalOrigin(externalUrl?: string, configFile?: string): Promise<string | undefined> {
  if (externalUrl !== undefined) return parseExternalOrigin(externalUrl);
  if (!configFile) return undefined;
  const config = accessSchema.parse(JSON.parse(await readFile(configFile, "utf8")));
  return parseExternalOrigin(config.externalUrl);
}
