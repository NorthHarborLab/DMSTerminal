import { useState, type FormEvent } from "react";
import { api } from "./api";
import { CredentialFields } from "./CredentialFields";
import { Icon } from "./Icon";
import { useDialog } from "./useDialog";
import type { Credential, ServerProfile } from "./types";

interface Props {
  profile: ServerProfile;
  onClose: () => void;
  onConnect: (profile: ServerProfile, credential: Credential, useSaved: boolean) => void;
  onSaved: () => void;
}

export function ConnectModal({ profile, onClose, onConnect, onSaved }: Props) {
  const [credential, setCredential] = useState<Credential>({});
  const [useSaved, setUseSaved] = useState(Boolean(profile.hasSavedCredential));
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useDialog<HTMLFormElement>(() => { if (!busy) onClose(); });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      let target = profile;
      if (!useSaved && save) {
        target = await api.updateProfile(profile.id, { name: profile.name, host: profile.host, port: profile.port,
          username: profile.username, authType: profile.authType, credential, credentialAction: "save" });
        onSaved();
      }
      onConnect(target, useSaved || save ? {} : credential, useSaved || save);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存凭据"); setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <form ref={dialog} className="modal connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-heading"><div><h2 id="connect-title">{profile.name}</h2><p>{profile.username}@{profile.host}:{profile.port}</p></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭"><Icon name="close" /></button></div>
      {profile.hasSavedCredential && <label className="checkbox-label"><input type="checkbox" checked={useSaved} onChange={(event) => setUseSaved(event.target.checked)} />使用已加密保存的凭据</label>}
      {useSaved ? <div className="saved-credential"><Icon name="key" /><span>凭据已保存, 无需再次输入</span></div> : <>
        <CredentialFields authType={profile.authType} value={credential} onChange={setCredential} />
        <label className="checkbox-label"><input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} />为当前 DSM 用户加密保存凭据</label>
      </>}
      <p className="security-note">首次连接需要确认服务器指纹。密钥与密码同时配置时, 先尝试密钥, 再尝试密码或完成双重认证。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? "连接中…" : "连接"}</button></div>
    </form>
  </div>;
}
