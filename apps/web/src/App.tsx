import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import { ConnectModal } from "./ConnectModal";
import { ProfileModal } from "./ProfileModal";
import { TerminalPane } from "./TerminalPane";
import { FilePane } from "./FilePane";
import { Icon } from "./Icon";
import { ThemeSettings } from "./ThemeSettings";
import { contrast, loadThemeSettings, resolveTheme, type ThemeSettings as ThemePreferences } from "./themes";
import type { Credential, ProfileInput, ServerProfile, TerminalSession } from "./types";

type ConnectionState = "connecting" | "connected" | "closed" | "error";

export default function App() {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [statuses, setStatuses] = useState<Record<string, ConnectionState>>({});
  const [profileModal, setProfileModal] = useState<ServerProfile | "new">();
  const [connectProfile, setConnectProfile] = useState<ServerProfile>();
  const [loadError, setLoadError] = useState("");
  const [filesOpen, setFilesOpen] = useState(true);
  const [themeOpen, setThemeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeSettings, setThemeSettings] = useState(loadThemeSettings);
  const theme = useMemo(() => resolveTheme(themeSettings), [themeSettings]);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const themeStyle = {
    "--bg": theme.background, "--panel": theme.panel, "--panel-raised": theme.raised,
    "--fg": theme.foreground, "--muted": theme.muted, "--line": theme.line,
    "--accent": theme.accent, "--danger": theme.danger,
    "--on-accent": contrast(theme.accent, "#101820") > contrast(theme.accent, "#ffffff") ? "#101820" : "#ffffff"
  } as CSSProperties;
  function applyTheme(settings: ThemePreferences) {
    setThemeSettings(settings);
    try { localStorage.setItem("dsm-terminal-theme", JSON.stringify(settings)); } catch { /* Theme remains available for this session */ }
  }

  const loadProfiles = useCallback(async () => {
    try {
      setProfiles(await api.listProfiles());
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "无法读取服务器");
    }
  }, []);

  useEffect(() => void loadProfiles(), [loadProfiles]);

  async function saveProfile(input: ProfileInput) {
    if (profileModal && profileModal !== "new") await api.updateProfile(profileModal.id, input);
    else await api.createProfile(input);
    await loadProfiles();
  }

  async function deleteProfile(profile: ServerProfile) {
    if (!window.confirm(`删除服务器“${profile.name}”？`)) return;
    try { await api.deleteProfile(profile.id); await loadProfiles(); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : "删除失败"); }
  }

  function openSession(profile: ServerProfile, credential: Credential, useSavedCredential = false) {
    const session: TerminalSession = { id: crypto.randomUUID(), profile, credential, useSavedCredential };
    setSessions((current) => [...current, session]);
    setActiveSessionId(session.id);
    setStatuses((current) => ({ ...current, [session.id]: "connecting" }));
    setConnectProfile(undefined);
    setSidebarOpen(false);
  }

  function closeSession(id: string) {
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === id);
      const next = current.filter((session) => session.id !== id);
      if (activeSessionId === id) setActiveSessionId(next[Math.max(0, index - 1)]?.id);
      return next;
    });
    setStatuses((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  return (
    <main className={`app-shell ${theme.light ? "light-theme" : ""}`} style={themeStyle}>
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭服务器列表" />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <header className="brand">
          <div className="brand-mark"><Icon name="terminal" /></div>
          <div>
            <strong>DSM Terminal</strong>
            <span>SSH / SFTP 工作台</span>
          </div>
        </header>

        <div className="sidebar-heading">
          <span>服务器</span>
          <button className="add-button" onClick={() => setProfileModal("new")} aria-label="添加服务器"><Icon name="plus" /></button>
        </div>

        <div className="server-list">
          {profiles.map((profile) => (
            <article className="server-card" key={profile.id}>
              <button className="server-main" onClick={() => setConnectProfile(profile)}>
                <span className="server-status" />
                <span>
                  <strong>{profile.name}</strong>
                  <small>{profile.username}@{profile.host}:{profile.port}</small>
                  {profile.hasSavedCredential && <small className="credential-badge"><Icon name="key" size={12} />凭据已保存</small>}
                  {profile.legacyShared && <small>旧版配置 · 编辑时复制为私有配置</small>}
                </span>
              </button>
              <div className="server-actions">
                <button onClick={() => setProfileModal(profile)} aria-label={`编辑 ${profile.name}`}>编辑</button>
                {!profile.legacyShared && <button onClick={() => void deleteProfile(profile)} aria-label={`删除 ${profile.name}`}>删除</button>}
              </div>
            </article>
          ))}
          {!profiles.length && !loadError && (
            <button className="empty-server" onClick={() => setProfileModal("new")}>
              <Icon name="plus" />
              添加第一台 SSH 服务器
            </button>
          )}
          {loadError && <p className="sidebar-error">{loadError}</p>}
        </div>

        <footer className="sidebar-footer">
          <button className="sidebar-settings" onClick={() => setThemeOpen(true)}><Icon name="settings" /><span>主题与颜色</span><span className="theme-dot" style={{ background: theme.accent }} /></button>
          <span className="security-caption"><Icon name="key" size={13} />凭据按 DSM 用户加密保存</span>
        </footer>
      </aside>

      <section className="workspace">
        <nav className="tabbar">
          {sessions.map((session) => (
            <div key={session.id} className={`tab ${activeSessionId === session.id ? "active" : ""}`}>
              <button className="tab-select" onClick={() => setActiveSessionId(session.id)}>
              <span className={`state-dot ${statuses[session.id] ?? "closed"}`} />
              <span>{session.profile.name}</span>
              </button>
              <button className="tab-close" aria-label={`关闭 ${session.profile.name} 终端`} onClick={() => closeSession(session.id)}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button className="new-tab" onClick={() => profiles[0] ? setConnectProfile(profiles[0]) : setProfileModal("new")} aria-label="新建终端"><Icon name="plus" /></button>
        </nav>

        <div className="workspace-toolbar"><button className="button compact secondary mobile-server-button" onClick={() => setSidebarOpen(true)}><Icon name="menu" />服务器</button><span className="workspace-target">{activeSession ? `${activeSession.profile.username}@${activeSession.profile.host}` : "选择服务器, 开始工作"}</span><span className="toolbar-spacer" /><button className="button compact secondary" onClick={() => setThemeOpen(true)} aria-label="主题与颜色"><Icon name="settings" />主题</button><button className={`button compact ${filesOpen ? "primary" : "secondary"}`} disabled={!sessions.length} onClick={() => setFilesOpen((value) => !value)} aria-pressed={filesOpen}><Icon name="folder" />文件</button></div>

        <div className="terminal-stack">
          {sessions.map((session) => <div key={session.id} className={`session-layout ${activeSessionId === session.id ? "active" : ""} ${filesOpen ? "has-files" : ""}`}>
            <div className="terminal-slot">
            <TerminalPane
              session={session}
              active={activeSessionId === session.id}
              theme={theme}
              onStatus={(state) => setStatuses((current) => current[session.id] === state ? current : { ...current, [session.id]: state })}
            />
            </div><div className="file-slot"><FilePane session={session} enabled={filesOpen && activeSessionId === session.id && statuses[session.id] === "connected"} active={filesOpen && activeSessionId === session.id} onClose={() => setFilesOpen(false)} /></div>
          </div>)}
          {!sessions.length && (
            <div className="welcome">
              <div className="welcome-symbol"><Icon name="terminal" size={32} /></div>
              <h1>终端与文件, 在同一个工作台。</h1>
              <p>连接 SSH 服务器, 在旁边浏览和传输文件。保存你的凭据, 选一套适合长时间工作的主题。</p>
              <button className="button primary" onClick={() => profiles[0] ? setConnectProfile(profiles[0]) : setProfileModal("new")}>
                {profiles.length ? "打开 SSH 连接" : "添加第一台服务器"}
              </button>
              <div className="feature-strip">
                <span>SSH2</span><i />
                <span>XTERM-256COLOR</span><i />
                <span>HOST KEY VERIFY</span>
              </div>
            </div>
          )}
        </div>

        <footer className="statusbar">
          <span><b>●</b> 服务就绪</span>
          <span>UTF-8</span>
          <span>xterm-256color</span>
        </footer>
      </section>

      {profileModal && (
        <ProfileModal profile={profileModal === "new" ? undefined : profileModal} onClose={() => setProfileModal(undefined)} onSave={saveProfile} />
      )}
      {connectProfile && <ConnectModal profile={connectProfile} onClose={() => setConnectProfile(undefined)} onConnect={openSession} onSaved={() => void loadProfiles()} />}
      {themeOpen && <ThemeSettings value={themeSettings} onChange={applyTheme} onClose={() => setThemeOpen(false)} />}
    </main>
  );
}
