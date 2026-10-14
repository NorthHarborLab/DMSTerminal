import { useRef, useState } from "react";
import type { AuthType, Credential } from "./types";

export function CredentialFields({ authType, value, onChange }: { authType: AuthType; value: Credential; onChange: (value: Credential) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return <div className="credential-fields">
    {authType !== "privateKey" && <label>SSH 密码<input required type="password" autoComplete="new-password" value={value.password ?? ""} onChange={(event) => onChange({ ...value, password: event.target.value })} /></label>}
    {authType !== "password" && <>
      <div className="field-heading"><span>SSH 私钥</span><button type="button" className="text-button" onClick={() => input.current?.click()}>从文件导入</button></div>
      <input ref={input} className="hidden-input" type="file" accept=".key,.pem,.ppk,.txt,*" aria-label="导入私钥" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (file.size > 100_000) { setError("私钥文件超过 100 KB"); return; }
        try { onChange({ ...value, privateKey: await file.text() }); setError(""); }
        catch { setError("无法读取私钥文件, 请粘贴内容"); }
      }} />
      <textarea aria-label="SSH 私钥" required rows={5} value={value.privateKey ?? ""} onChange={(event) => onChange({ ...value, privateKey: event.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} autoComplete="off" />
      <label>私钥口令 (可选)<input type="password" autoComplete="new-password" value={value.passphrase ?? ""} onChange={(event) => onChange({ ...value, passphrase: event.target.value })} /></label>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
