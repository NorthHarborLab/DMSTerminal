import { useState } from "react";
import { defaultThemeSettings, resolveTheme, themeContrastProblem, themes, type ThemeSettings as Settings } from "./themes";
import { Icon } from "./Icon";
import { useDialog } from "./useDialog";

export function ThemeSettings({ value, onChange, onClose }: { value: Settings; onChange: (value: Settings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const dialog = useDialog(onClose);
  const theme = resolveTheme(draft);
  const invalidColors = themeContrastProblem(theme);
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div ref={dialog} className="modal theme-modal" role="dialog" aria-modal="true" aria-labelledby="theme-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-heading"><div><h2 id="theme-title">主题与颜色</h2><p>界面与终端同步配色, 在此浏览器中记住选择</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></div>
      <div className="theme-grid">{themes.map((preset) => <button key={preset.id} aria-pressed={!draft.custom && draft.preset === preset.id} className={`theme-option ${!draft.custom && draft.preset === preset.id ? "selected" : ""}`} onClick={() => setDraft({ preset: preset.id, custom: false, accent: preset.accent, background: preset.background, foreground: preset.foreground })}>
        <span className="theme-sample" style={{ background: preset.background, color: preset.foreground, borderColor: preset.line }}><i style={{ background: preset.accent }} />终端 <span style={{ color: preset.accent }}>$</span></span><span>{preset.name}</span>
      </button>)}</div>
      <label className="checkbox-label"><input type="checkbox" checked={draft.custom} onChange={(event) => setDraft({ ...draft, custom: event.target.checked })} />自定义颜色</label>
      {draft.custom && <div className="color-fields">{([['accent', '强调色'], ['background', '背景色'], ['foreground', '文字色']] as const).map(([key, label]) => <label key={key}>{label}<input type="color" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /><span>{draft[key]}</span></label>)}</div>}
      <div className="theme-terminal-preview" style={{ background: theme.background, color: theme.foreground }}><span style={{ color: theme.accent }}>user@server:~$</span> ls -la<br />documents/  images/  readme.md<span className="preview-cursor" style={{ background: theme.accent }} /></div>
      {invalidColors && <p className="form-error" role="alert">文字在背景和面板上的对比度不足, 请调整文字色或强调色</p>}
      <div className="modal-actions"><button className="button secondary" onClick={() => setDraft(defaultThemeSettings)}>恢复默认</button><button className="button primary" disabled={invalidColors} onClick={() => { onChange(draft); onClose(); }}>应用主题</button></div>
    </div>
  </div>;
}
