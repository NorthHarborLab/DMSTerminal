export type AuthType = "password" | "privateKey" | "passwordAndKey";

export interface Credential {
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  hostFingerprint?: string;
  createdAt: string;
  updatedAt: string;
  hasSavedCredential?: boolean;
  legacyShared?: boolean;
}

export interface TerminalTicket {
  profile: ServerProfile;
  credential: {
    password?: string;
    privateKey?: string;
    passphrase?: string;
  };
  acceptedFingerprint?: string;
  cols: number;
  rows: number;
  expiresAt: number;
  ownerId: string;
  purpose: "terminal" | "files";
}
