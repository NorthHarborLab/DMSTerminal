import { useState, type FormEvent } from "react";
import type { Credential, ProfileInput, ServerProfile } from "./types";
import { CredentialFields } from "./CredentialFields";
import { Icon } from "./Icon";
import { useDialog } from "./useDialog";

interface Props {
  profile?: ServerProfile;
  onClose: () => void;
  onSave: (input: ProfileInput) => Promise<void>;
}

export function ProfileModal({ profile, onClose, onSave }: Props) {
  const [form, setForm] = useState<ProfileInput>({
    name: profile?.name ?? "", host: profile?.host ?? "", port: profile?.port ?? 22,
    username: profile?.username ?? "", authType: profile?.authType ?? "password",
    credentialAction: profile?.hasSavedCredential ? "keep" : "remove"
  });
  const [credential, setCredential] = useState<Credential>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useDialog<HTMLFormElement>(() => { if (!saving) onClose(); });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await onSave({ ...form, credential: form.credentialAction === "save" ? credential : undefined });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setSaving(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!saving) onClose(); }}>
      <form ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div><h2 id="profile-title">{profile?.legacyShared ? "复制旧配置到我的服务器" : profile ? "编辑服务器" : "添加服务器"}</h2><p>配置连接信息和保存方式</p></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="关闭"><Icon name="close" /></button>
        </div>
        <label>显示名称<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如: 开发服务器" /></label>
        <div className="form-row">
          <label className="grow">主机地址<input required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="192.168.1.100" /></label>
          <label className="port-field">端口<input required type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} /></label>
        </div>
        <label>用户名<input required autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label>认证方式<select aria-label="认证方式" value={form.authType} onChange={(event) => setForm({ ...form, authType: event.target.value as ProfileInput["authType"], credentialAction: "remove" })}>
          <option value="password">账号 + 密码</option><option value="privateKey">账号 + SSH 私钥</option><option value="passwordAndKey">账号 + SSH 私钥 + 密码</option>
        </select></label>
        <label>凭据保存<select aria-label="凭据保存" value={form.credentialAction} onChange={(event) => setForm({ ...form, credentialAction: event.target.value as ProfileInput["credentialAction"] })}>
          {profile?.hasSavedCredential && <option value="keep">保留已保存的凭据</option>}
          <option value="save">{profile?.hasSavedCredential ? "更新并加密保存" : "加密保存"}</option>
          <option value="remove">每次连接时输入{profile?.hasSavedCredential ? " (清除已保存凭据)" : ""}</option>
        </select></label>
        {form.credentialAction === "save" && <CredentialFields authType={form.authType} value={credential} onChange={setCredential} />}
        {form.credentialAction === "keep" && profile && (form.username !== profile.username || form.host !== profile.host || form.port !== profile.port) && <p className="security-note">连接地址或用户名改变后, 旧凭据会清除。请选择重新保存或下次连接输入。</p>}
        <p className="security-note">保存的密码、私钥和私钥口令会加密, 仅当前 DSM 用户可以使用。不会在界面中回显。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? "保存中…" : "保存服务器"}</button></div>
      </form>
    </div>
  );
}
