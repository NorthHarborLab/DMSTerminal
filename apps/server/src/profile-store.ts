import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthType, Credential, ServerProfile } from "./types.js";
import type { CredentialVault, EncryptedCredential } from "./credential-vault.js";

export interface ProfileInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  credential?: Credential;
  credentialAction?: "keep" | "save" | "remove";
}

interface StoredProfile extends ServerProfile {
  ownerId?: string;
  encryptedAccount?: EncryptedCredential;
  encryptedCredential?: EncryptedCredential;
}

function publicProfile(profile: StoredProfile, vault: CredentialVault): ServerProfile {
  const { ownerId, encryptedCredential, encryptedAccount, ...safe } = profile;
  const username = ownerId && encryptedAccount ? vault.decrypt(ownerId, `${profile.id}:account`, encryptedAccount).username : profile.username;
  return { ...safe, username: username ?? "", hasSavedCredential: Boolean(encryptedCredential), legacyShared: !ownerId };
}

export class ProfileStore {
  private profiles = new Map<string, StoredProfile>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly vault: CredentialVault) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as StoredProfile[];
      this.profiles = new Map(parsed.map((profile) => [profile.id, profile]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  list(ownerId: string): ServerProfile[] {
    return [...this.profiles.values()].filter((profile) => !profile.ownerId || profile.ownerId === ownerId)
      .map((profile) => publicProfile(profile, this.vault)).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string, ownerId: string): ServerProfile | undefined {
    const profile = this.profiles.get(id);
    return profile && (!profile.ownerId || profile.ownerId === ownerId) ? publicProfile(profile, this.vault) : undefined;
  }

  resolveCredential(id: string, ownerId: string, provided: Credential, useSaved: boolean): Credential {
    const profile = this.profiles.get(id);
    if (!profile || (profile.ownerId && profile.ownerId !== ownerId)) throw new Error("服务器不存在");
    if (!useSaved) return provided;
    if (profile.ownerId !== ownerId || !profile.encryptedCredential) throw new Error("尚未保存连接凭据");
    return this.vault.decrypt(ownerId, id, profile.encryptedCredential);
  }

  private applyCredential(profile: StoredProfile, input: ProfileInput): void {
    if (input.credentialAction === "remove") delete profile.encryptedCredential;
    if (input.credentialAction === "save" && input.credential && profile.ownerId) {
      profile.encryptedCredential = this.vault.encrypt(profile.ownerId, profile.id, input.credential);
    }
  }

  async create(input: ProfileInput, ownerId: string): Promise<ServerProfile> {
    const now = new Date().toISOString();
    const { credential: _credential, credentialAction: _action, ...metadata } = input;
    const profile: StoredProfile = { id: randomUUID(), ...metadata, ownerId, createdAt: now, updatedAt: now };
    profile.encryptedAccount = this.vault.encrypt(ownerId, `${profile.id}:account`, { username: profile.username });
    profile.username = "";
    this.applyCredential(profile, input);
    this.profiles.set(profile.id, profile);
    await this.persist();
    return publicProfile(profile, this.vault);
  }

  async update(id: string, input: ProfileInput, ownerId: string): Promise<ServerProfile | undefined> {
    const current = this.profiles.get(id);
    if (!current || (current.ownerId && current.ownerId !== ownerId)) return undefined;
    if (!current.ownerId) return this.create(input, ownerId);
    const endpointUnchanged = current.host === input.host && current.port === input.port;
    const authUnchanged = endpointUnchanged && publicProfile(current, this.vault).username === input.username && current.authType === input.authType;
    const { credential: _credential, credentialAction: _action, ...metadata } = input;
    const profile: StoredProfile = { ...current, ...metadata, hostFingerprint: endpointUnchanged ? current.hostFingerprint : undefined, updatedAt: new Date().toISOString() };
    profile.encryptedAccount = this.vault.encrypt(ownerId, `${profile.id}:account`, { username: input.username });
    profile.username = "";
    if (!authUnchanged) delete profile.encryptedCredential;
    this.applyCredential(profile, input);
    this.profiles.set(id, profile);
    await this.persist();
    return publicProfile(profile, this.vault);
  }

  async trustFingerprint(id: string, fingerprint: string): Promise<void> {
    const current = this.profiles.get(id);
    if (!current) return;
    this.profiles.set(id, { ...current, hostFingerprint: fingerprint, updatedAt: new Date().toISOString() });
    await this.persist();
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    if (this.profiles.get(id)?.ownerId !== ownerId) return false;
    this.profiles.delete(id);
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    const snapshot = `${JSON.stringify([...this.profiles.values()], null, 2)}\n`;
    const write = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, snapshot, { mode: 0o600 });
      await rename(tempPath, this.filePath);
    });
    this.writeQueue = write;
    await write;
  }
}
