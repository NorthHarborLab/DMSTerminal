import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Credential } from "./types.js";

export interface EncryptedCredential {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialVault {
  private masterKey?: Buffer;
  constructor(private readonly keyFile: string) {}

  async load(): Promise<void> {
    await mkdir(dirname(this.keyFile), { recursive: true, mode: 0o700 });
    try {
      this.masterKey = await readFile(this.keyFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await writeFile(this.keyFile, randomBytes(32), { flag: "wx", mode: 0o600 });
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      }
      this.masterKey = await readFile(this.keyFile);
    }
    if (this.masterKey.length !== 32) throw new Error("凭据主密钥文件无效, 请恢复原始密钥备份");
    await chmod(this.keyFile, 0o600);
  }

  private userKey(ownerId: string): Buffer {
    if (!this.masterKey) throw new Error("凭据密钥尚未初始化");
    return Buffer.from(hkdfSync("sha256", this.masterKey, "DSMTerminal/v1", ownerId, 32));
  }

  encrypt(ownerId: string, profileId: string, credential: Credential): EncryptedCredential {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.userKey(ownerId), iv);
    cipher.setAAD(Buffer.from(`${ownerId}:${profileId}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
    return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  }

  decrypt(ownerId: string, profileId: string, encrypted: EncryptedCredential): Credential {
    if (encrypted.version !== 1) throw new Error("不支持的凭据加密版本");
    const decipher = createDecipheriv("aes-256-gcm", this.userKey(ownerId), Buffer.from(encrypted.iv, "base64"));
    decipher.setAAD(Buffer.from(`${ownerId}:${profileId}`));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8")) as Credential;
  }
}
