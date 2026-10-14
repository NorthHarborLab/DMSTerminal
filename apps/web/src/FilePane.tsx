import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { Icon } from "./Icon";
import type { FilePreview, RemoteEntry, TerminalSession } from "./types";

function parent(path: string) { return path.slice(0, path.lastIndexOf("/")) || "/"; }
function child(path: string, name: string) { return `${path === "/" ? "" : path}/${name}`; }
function isImage(name: string) { return /\.(png|jpe?g|gif|webp)$/i.test(name); }
function size(value: number) {
  if (value < 1024) return `${value} B`;
  const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(1)} ${["B", "KiB", "MiB", "GiB"][index]}`;
}
function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : "文件操作失败, 请重试"; }

function Thumbnail({ entry, sessionId }: { entry: RemoteEntry; sessionId: string }) {
  const target = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState<string>();
  useEffect(() => {
    if (!target.current || !isImage(entry.name) || entry.size > 512 * 1024) return;
    const controller = new AbortController();
    const observer = new IntersectionObserver((events) => {
      if (!events.some((event) => event.isIntersecting)) return;
      observer.disconnect();
      void api.previewFile(sessionId, entry.path, controller.signal).then((preview) => {
        if (!controller.signal.aborted && preview.type === "image") setSource(`data:${preview.mime};base64,${preview.data}`);
      }).catch(() => undefined);
    });
    observer.observe(target.current);
    return () => { observer.disconnect(); controller.abort(); };
  }, [entry.name, entry.path, entry.size, sessionId]);
  return <span ref={target} className="file-thumbnail">{source ? <img src={source} alt="" loading="lazy" /> : <Icon size={32} name={entry.type === "directory" ? "folder" : entry.type === "link" ? "link" : isImage(entry.name) ? "image" : "file"} />}</span>;
}

interface Props { session: TerminalSession; enabled: boolean; active: boolean; onClose: () => void }
interface Transfer { name: string; sent: number; total: number; status: "uploading" | "done" | "error" | "cancelled"; error?: string }

export function FilePane({ session, enabled, active, onClose }: Props) {
  const [sessionId, setSessionId] = useState<string>();
  const [path, setPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [selected, setSelected] = useState<RemoteEntry>();
  const [mode, setMode] = useState<"details" | "grid">("details");
  const [sort, setSort] = useState<"name" | "size" | "modifiedAt">("name");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fingerprint, setFingerprint] = useState<string>();
  const [preview, setPreview] = useState<FilePreview>();
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [action, setAction] = useState<"mkdir" | "rename" | "chmod">();
  const [actionValue, setActionValue] = useState("");
  const [actionTarget, setActionTarget] = useState<RemoteEntry>();
  const [actionDirectory, setActionDirectory] = useState("/");
  const [busy, setBusy] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const idRef = useRef<string | undefined>(undefined);
  const connectSequence = useRef(0);
  const listSequence = useRef(0);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const load = useCallback(async (id: string, requestedPath: string) => {
    const sequence = ++listSequence.current;
    setLoading(true); setError("");
    try {
      const result = await api.listFiles(id, requestedPath);
      if (!alive.current || sequence !== listSequence.current) return;
      setPath(result.path); setPathInput(result.path); setEntries(result.entries); setSelected(undefined); setAction(undefined);
    } catch (cause) {
      if (!alive.current || sequence !== listSequence.current) return;
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 404) { idRef.current = undefined; setSessionId(undefined); }
    } finally { if (alive.current && sequence === listSequence.current) setLoading(false); }
  }, []);

  const connect = useCallback(async (acceptedFingerprint?: string) => {
    const sequence = ++connectSequence.current;
    setConnecting(true); setError(""); setFingerprint(undefined);
    const oldId = idRef.current;
    idRef.current = undefined; setSessionId(undefined);
    if (oldId) void api.closeFileSession(oldId).catch(() => undefined);
    try {
      const { ticket } = await api.createTicket(session.profile.id, session.credential, 120, 36, acceptedFingerprint, session.useSavedCredential, "files");
      if (!alive.current || sequence !== connectSequence.current) return;
      const result = await api.createFileSession(ticket);
      if (!alive.current || sequence !== connectSequence.current) { void api.closeFileSession(result.sessionId).catch(() => undefined); return; }
      idRef.current = result.sessionId; setSessionId(result.sessionId);
      await load(result.sessionId, result.path);
    } catch (cause) {
      if (!alive.current || sequence !== connectSequence.current) return;
      if (cause instanceof ApiError && cause.code === "FINGERPRINT_REQUIRED" && cause.fingerprint) setFingerprint(cause.fingerprint);
      else setError(errorMessage(cause));
    } finally { if (alive.current && sequence === connectSequence.current) setConnecting(false); }
  }, [load, session]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; connectSequence.current++; listSequence.current++;
      uploadController.current?.abort();
      if (idRef.current) void api.closeFileSession(idRef.current).catch(() => undefined);
      idRef.current = undefined;
    };
  }, []);
  useEffect(() => { if (enabled && !idRef.current) void connect(); }, [enabled, connect]);

  useEffect(() => {
    setPreview(undefined); setPreviewError("");
    if (!selected || selected.type !== "file" || !sessionId || !active) { setPreviewLoading(false); return; }
    const controller = new AbortController();
    setPreviewLoading(true);
    void api.previewFile(sessionId, selected.path, controller.signal).then((result) => {
      if (!controller.signal.aborted) setPreview(result);
    }).catch((cause) => { if (!controller.signal.aborted) setPreviewError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [selected, sessionId, active]);

  async function submitAction(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !action || (action !== "mkdir" && !actionTarget)) return;
    if (action !== "chmod" && (!actionValue || actionValue.includes("/") || [".", ".."].includes(actionValue))) { setError("请输入不含 / 的文件或目录名称"); return; }
    setBusy(true); setError("");
    try {
      await api.fileOperation(sessionId, { operation: action, path: action === "mkdir" ? child(actionDirectory, actionValue) : actionTarget!.path,
        destination: action === "rename" ? child(parent(actionTarget!.path), actionValue) : undefined, mode: action === "chmod" ? actionValue : undefined });
      setMessage(action === "mkdir" ? "目录已创建" : action === "rename" ? "已重命名" : "权限已修改"); setAction(undefined);
      await load(sessionId, path);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function beginAction(operation: "mkdir" | "rename" | "chmod") {
    setAction(operation); setActionTarget(selected); setActionDirectory(path);
    setActionValue(operation === "mkdir" ? "" : operation === "rename" ? selected?.name ?? "" : selected?.permissions ?? "");
  }
  async function remove() {
    if (!selected || !sessionId || !window.confirm(`删除“${selected.name}”? 此操作无法撤销${selected.type === "directory" ? ", 仅支持空目录" : ""}`)) return;
    setBusy(true); setError("");
    try { await api.fileOperation(sessionId, { operation: "delete", path: selected.path }); setMessage("已删除"); await load(sessionId, path); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function download() {
    if (!sessionId || !selected) return;
    try { await api.downloadFile(sessionId, selected.path); setMessage(`已交给浏览器下载: ${selected.name}`); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  async function upload(files: FileList | File[]) {
    if (!sessionId || busy || uploadController.current) return;
    const batch = Array.from(files);
    const controller = new AbortController(); uploadController.current = controller;
    setTransfers(batch.map((file) => ({ name: file.name, sent: 0, total: file.size, status: "uploading" })));
    setBusy(true); setError("");
    for (let index = 0; index < batch.length; index++) {
      const file = batch[index]!;
      const update = (change: Partial<Transfer>) => { if (alive.current) setTransfers((current) => current.map((item, position) => position === index ? { ...item, ...change } : item)); };
      if (controller.signal.aborted) { update({ status: "cancelled" }); continue; }
      try {
        if (file.size > 1024 ** 3) throw new Error("单个文件不能超过 1 GiB");
        let overwrite = false;
        if (entries.some((entry) => entry.name === file.name)) {
          overwrite = window.confirm(`远程文件“${file.name}”已存在, 是否覆盖?`);
          if (!overwrite) { update({ status: "cancelled" }); continue; }
        }
        await api.uploadFile(sessionId, child(path, file.name), file, overwrite, controller.signal, (sent) => update({ sent }));
        update({ status: "done", sent: file.size });
      } catch (cause) { update({ status: controller.signal.aborted ? "cancelled" : "error", error: errorMessage(cause) }); }
    }
    uploadController.current = undefined;
    if (alive.current) { setBusy(false); await load(sessionId, path); }
  }
  function open(entry: RemoteEntry) {
    if (entry.type === "directory" || entry.type === "link") { if (sessionId) void load(sessionId, entry.path); }
    else setSelected(entry);
  }
  const visible = entries.filter((entry) => (showHidden || !entry.name.startsWith(".")) && entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (b.type === "directory" && a.type !== "directory") return 1;
    return sort === "name" ? a.name.localeCompare(b.name, "zh-CN", { numeric: true }) : b[sort] - a[sort];
  });
  const breadcrumbs = path.split("/").filter(Boolean);
  return <aside className={`file-pane ${active ? "active" : ""}`} aria-label={`文件管理 ${session.profile.name}`} onDragOver={(event) => { if (sessionId && !busy) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void upload(event.dataTransfer.files); }}>
    <header className="file-heading"><span><Icon name="folder" />文件管理</span><div><span className="muted">SFTP</span><button className="icon-button" onClick={onClose} aria-label="收起文件管理"><Icon name="close" /></button></div></header>
    {!sessionId ? <div className="file-empty">
      <Icon name="folder" size={38} /><h3>{connecting ? "正在连接文件服务…" : "打开服务器文件"}</h3>
      <p>{connecting ? "正在建立 SFTP 连接" : "通过同一台服务器的 SSH 账号管理文件"}</p>
      {fingerprint && <><p>请核对服务器指纹</p><code>{fingerprint}</code><button className="button primary" onClick={() => void connect(fingerprint)}>信任并连接</button></>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!connecting && !fingerprint && <button className="button primary" onClick={() => void connect()}>连接文件服务</button>}
    </div> : <>
      <div className="file-toolbar">
        <button className="icon-button" disabled={loading || busy || path === "/"} onClick={() => void load(sessionId, parent(path))} aria-label="上级目录"><Icon name="up" /></button>
        <button className="icon-button" disabled={loading || busy} onClick={() => void load(sessionId, path)} aria-label="刷新文件"><Icon name="refresh" /></button>
        <button className="button compact secondary" disabled={busy} onClick={() => uploadInput.current?.click()}><Icon name="upload" />上传</button>
        <button className="button compact secondary" disabled={busy} onClick={() => beginAction("mkdir")}><Icon name="plus" />新建目录</button>
        <span className="toolbar-spacer" />
        <button className={`icon-button ${mode === "details" ? "selected" : ""}`} aria-pressed={mode === "details"} onClick={() => setMode("details")} aria-label="详情列表"><Icon name="list" /></button>
        <button className={`icon-button ${mode === "grid" ? "selected" : ""}`} aria-pressed={mode === "grid"} onClick={() => setMode("grid")} aria-label="缩略图视图"><Icon name="grid" /></button>
        <input ref={uploadInput} className="hidden-input" type="file" multiple onChange={(event) => { if (event.target.files) void upload(event.target.files); event.target.value = ""; }} />
      </div>
      <form className="path-form" onSubmit={(event) => { event.preventDefault(); if (!busy) void load(sessionId, pathInput); }}><input aria-label="远程目录路径" value={pathInput} onChange={(event) => setPathInput(event.target.value)} /><button className="icon-button" disabled={loading || busy} aria-label="打开目录"><Icon name="chevron" /></button></form>
      <nav className="breadcrumbs" aria-label="目录导航"><button disabled={busy} onClick={() => void load(sessionId, "/")}>/</button>{breadcrumbs.map((part, index) => <span key={index}><Icon name="chevron" size={12} /><button disabled={busy} onClick={() => void load(sessionId, `/${breadcrumbs.slice(0, index + 1).join("/")}`)}>{part}</button></span>)}</nav>
      <div className="file-filters"><input aria-label="筛选当前目录" placeholder="筛选名称…" value={query} onChange={(event) => setQuery(event.target.value)} /><label className="checkbox-label"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />隐藏文件</label><select aria-label="文件排序" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="name">名称</option><option value="size">大小</option><option value="modifiedAt">修改时间</option></select></div>
      {error && <div className="file-error" role="alert">{error}<button className="text-button" disabled={busy || connecting} onClick={() => void connect()}>重新连接</button></div>}
      {action && <form className="file-action-form" onSubmit={submitAction}><label title={actionTarget?.path ?? actionDirectory}>{action === "mkdir" ? "新目录名称" : `${actionTarget?.name}: ${action === "rename" ? "新名称" : "权限 (如 0755)"}`}<input aria-label={action === "mkdir" ? "新目录名称" : action === "rename" ? "新名称" : "权限值"} autoFocus required value={actionValue} onChange={(event) => setActionValue(event.target.value)} /></label><button className="button compact primary" disabled={busy}>确认</button><button type="button" className="text-button" disabled={busy} onClick={() => setAction(undefined)}>取消</button></form>}
      <div className="file-list-area" aria-busy={loading}>
        {loading ? <p className="file-loading" role="status">读取目录中…</p> : !visible.length ? <div className="file-list-empty"><Icon name="folder" size={30} /><p>{query ? "没有匹配的文件" : "当前目录没有可见文件"}</p><span>可拖入文件上传, 或显示隐藏文件</span></div> : mode === "details" ? <table className="file-table"><thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th>权限</th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.path} tabIndex={0} aria-selected={selected?.path === entry.path} className={selected?.path === entry.path ? "selected" : ""} onClick={() => setSelected(entry)} onDoubleClick={() => { if (!busy) open(entry); }} onKeyDown={(event) => { if (event.key === "Enter" && !busy) open(entry); if (event.key === " ") { event.preventDefault(); setSelected(entry); } }}>
          <td><span className="filename"><Icon name={entry.type === "directory" ? "folder" : entry.type === "link" ? "link" : isImage(entry.name) ? "image" : "file"} /><span title={entry.name}>{entry.name}</span></span></td><td>{entry.type === "directory" ? "—" : size(entry.size)}</td><td>{new Date(entry.modifiedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>{entry.permissions}</td>
        </tr>)}</tbody></table> : <div className="file-grid">{visible.map((entry) => <button key={entry.path} className={`file-tile ${selected?.path === entry.path ? "selected" : ""}`} onClick={() => setSelected(entry)} onDoubleClick={() => { if (!busy) open(entry); }} onKeyDown={(event) => { if (event.key === "Enter" && !busy) open(entry); }}><Thumbnail entry={entry} sessionId={sessionId} /><span title={entry.name}>{entry.name}</span><small>{entry.type === "directory" ? "目录" : size(entry.size)}</small></button>)}</div>}
      </div>
      {selected && <section className="file-inspector" aria-label="文件详情和预览"><div className="inspector-heading"><strong title={selected.name}>{selected.name}</strong><button className="icon-button" onClick={() => setSelected(undefined)} aria-label="关闭文件预览"><Icon name="close" size={15} /></button></div><dl><dt>大小</dt><dd>{size(selected.size)}</dd><dt>权限</dt><dd>{selected.permissions}</dd><dt>修改</dt><dd>{new Date(selected.modifiedAt).toLocaleString("zh-CN")}</dd><dt>UID / GID</dt><dd>{selected.uid} / {selected.gid}</dd></dl>
        <div className="file-selection-actions">{selected.type !== "file" ? <button className="button compact secondary" disabled={busy} onClick={() => open(selected)}>打开目录 / 链接</button> : <button className="button compact secondary" disabled={busy} onClick={() => void download()}><Icon name="download" size={15} />下载</button>}<button className="button compact secondary" disabled={busy} onClick={() => beginAction("rename")}>重命名</button><button className="button compact secondary" disabled={busy} onClick={() => beginAction("chmod")}>权限</button><button className="button compact danger" disabled={busy} onClick={() => void remove()}>删除</button></div>
        {previewLoading && <p className="muted" role="status">读取预览中…</p>}{previewError && <p className="preview-note">{previewError}</p>}
        {preview?.type === "image" && <img className="file-image-preview" src={`data:${preview.mime};base64,${preview.data}`} alt={selected.name} />}
        {preview?.type === "text" && <><pre className="file-text-preview">{preview.text || "(空文件)"}</pre>{preview.truncated && <p className="preview-note">仅预览前 256 KiB, 下载可查看完整内容</p>}</>}
      </section>}
      {transfers.length > 0 && <section className="transfer-list" aria-label="上传任务"><div className="transfer-heading"><strong>上传任务</strong>{busy && uploadController.current ? <button className="text-button" onClick={() => uploadController.current?.abort()}>取消上传</button> : <button className="text-button" onClick={() => setTransfers([])}>清除</button>}</div>{transfers.map((transfer, index) => <div key={index} className="transfer-row"><span title={transfer.name}>{transfer.name}</span><small>{transfer.status === "done" ? "已完成" : transfer.status === "cancelled" ? "已取消" : transfer.status === "error" ? transfer.error : `${size(transfer.sent)} / ${size(transfer.total)}`}</small><progress max={transfer.total || 1} value={transfer.status === "done" ? transfer.total || 1 : transfer.sent} aria-label={`${transfer.name} 上传进度`} /></div>)}</section>}
      <footer className="file-footer"><span>{visible.length} 个项目</span><span role="status">{message || "拖放文件到面板即可上传"}</span></footer>
    </>}
  </aside>;
}
