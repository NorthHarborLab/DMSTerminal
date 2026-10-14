import ssh2 from "ssh2";
import type { AuthType, Credential } from "./types.js";

export function credentialProblem(authType: AuthType, credential: Credential): string | undefined {
  if (authType !== "privateKey" && !credential.password) return "请输入 SSH 密码";
  if (authType !== "password") {
    if (!credential.privateKey) return "请输入 SSH 私钥";
    const parsed = ssh2.utils.parseKey(credential.privateKey, credential.passphrase);
    if (parsed instanceof Error) return "私钥格式无效或私钥口令不正确, 请检查后重试";
    const keys = Array.isArray(parsed) ? parsed : [parsed];
    if (!keys.every((key) => key.isPrivateKey())) return "请提供 SSH 私钥, 不能使用公钥";
  }
  return undefined;
}
