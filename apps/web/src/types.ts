export type AuthType = "password" | "privateKey" | "passwordAndKey";

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

export interface ProfileInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  credential?: Credential;
  credentialAction?: "keep" | "save" | "remove";
}

export interface Credential {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface TerminalSession {
  id: string;
  profile: ServerProfile;
  credential: Credential;
  useSavedCredential?: boolean;
}

export interface RemoteEntry {
  name: string;
  path: string;
  type: "directory" | "file" | "link";
  size: number;
  modifiedAt: number;
  permissions: string;
  uid: number;
  gid: number;
}

export interface FilePreview {
  type: "image" | "text";
  mime?: string;
  data?: string;
  text?: string;
  size: number;
  truncated: boolean;
}
