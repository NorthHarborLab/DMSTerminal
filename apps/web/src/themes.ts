export interface ThemeColors {
  id: string;
  name: string;
  light: boolean;
  background: string;
  panel: string;
  raised: string;
  foreground: string;
  muted: string;
  line: string;
  accent: string;
  danger: string;
}

export const themes: ThemeColors[] = [
  { id: "mint", name: "薄荷深夜", light: false, background: "#090c10", panel: "#0e1319", raised: "#182129", foreground: "#e7efeb", muted: "#9caab2", line: "#303d46", accent: "#70f7b0", danger: "#ff8c8c" },
  { id: "ocean", name: "深海蓝", light: false, background: "#0c1521", panel: "#111e2e", raised: "#1b2c40", foreground: "#e4edf9", muted: "#a3b4ca", line: "#344a65", accent: "#75beff", danger: "#ff9090" },
  { id: "amber", name: "琥珀暖夜", light: false, background: "#18140f", panel: "#211b14", raised: "#33291e", foreground: "#f5ecdb", muted: "#c0b49f", line: "#554534", accent: "#ffd18b", danger: "#ff9790" },
  { id: "violet", name: "暮色紫", light: false, background: "#16131f", panel: "#201b2c", raised: "#30283f", foreground: "#eee8f8", muted: "#b8accd", line: "#4c3f61", accent: "#cbb1ff", danger: "#ff94a8" },
  { id: "paper", name: "明亮纸白", light: true, background: "#f7f9fc", panel: "#edf1f6", raised: "#ffffff", foreground: "#202d3d", muted: "#52647a", line: "#bdc9d8", accent: "#1762a5", danger: "#b3233b" },
  { id: "graphite", name: "石墨灰", light: false, background: "#17191d", panel: "#202329", raised: "#2c3038", foreground: "#eceff4", muted: "#afb7c4", line: "#464e5c", accent: "#b8d4ee", danger: "#ff9292" }
];

export interface ThemeSettings { preset: string; custom: boolean; accent: string; background: string; foreground: string }
export const defaultThemeSettings: ThemeSettings = { preset: "mint", custom: false, accent: "#70f7b0", background: "#090c10", foreground: "#e7efeb" };

function luminance(hex: string) {
  const parts = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return parts[0]! * 0.2126 + parts[1]! * 0.7152 + parts[2]! * 0.0722;
}
export function contrast(a: string, b: string) {
  const left = luminance(a), right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
function mix(a: string, b: string, ratio: number) {
  return "#" + [1, 3, 5].map((offset) => Math.round(Number.parseInt(a.slice(offset, offset + 2), 16) * (1 - ratio) + Number.parseInt(b.slice(offset, offset + 2), 16) * ratio).toString(16).padStart(2, "0")).join("");
}
export function resolveTheme(settings: ThemeSettings): ThemeColors {
  const base = themes.find((theme) => theme.id === settings.preset) ?? themes[0]!;
  if (!settings.custom || ![settings.accent, settings.background, settings.foreground].every((value) => /^#[a-f0-9]{6}$/i.test(value))) return base;
  const custom: ThemeColors = { ...base, id: "custom", name: "自定义", accent: settings.accent, background: settings.background, foreground: settings.foreground,
    panel: mix(settings.background, settings.foreground, 0.035), raised: mix(settings.background, settings.foreground, 0.075),
    muted: mix(settings.background, settings.foreground, 0.7), line: mix(settings.background, settings.foreground, 0.26), light: luminance(settings.background) > 0.4 };
  for (let ratio = 0.7; ratio <= 1.001; ratio += 0.025) {
    const candidate = mix(settings.background, settings.foreground, Math.min(1, ratio));
    if ([custom.background, custom.panel, custom.raised].every((surface) => contrast(candidate, surface) >= 4.5)) { custom.muted = candidate; break; }
  }
  return custom;
}

export function themeContrastProblem(theme: ThemeColors): boolean {
  return [theme.background, theme.panel, theme.raised].some((surface) =>
    contrast(theme.foreground, surface) < 4.5 || contrast(theme.muted, surface) < 4.5 || contrast(theme.accent, surface) < 4.5);
}

export function terminalTheme(theme: ThemeColors) {
  const ansi = theme.light ? {
    black: "#202d3d", red: "#b3233b", green: "#206e45", yellow: "#785300", blue: "#1762a5", magenta: "#773da1", cyan: "#036970", white: "#52647a",
    brightBlack: "#52647a", brightRed: "#a4162e", brightGreen: "#175b36", brightYellow: "#704900", brightBlue: "#12548d", brightMagenta: "#67328e", brightCyan: "#005862", brightWhite: "#202d3d"
  } : {
    black: "#10151b", red: "#ff6b6b", green: "#70f7b0", yellow: "#f4d35e", blue: "#71a7ff", magenta: "#c792ea", cyan: "#5de4c7", white: "#dce7e2",
    brightBlack: "#8f9fa9", brightRed: "#ff8787", brightGreen: "#8cffc1", brightYellow: "#ffe180", brightBlue: "#91bbff", brightMagenta: "#d6a5f1", brightCyan: "#83f0da", brightWhite: "#ffffff"
  };
  return { ...ansi, background: theme.background, foreground: theme.foreground, cursor: theme.accent, cursorAccent: theme.background, selectionBackground: `${theme.accent}55` };
}

export function loadThemeSettings(): ThemeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem("dsm-terminal-theme") ?? "null");
    return saved && typeof saved.preset === "string" ? { ...defaultThemeSettings, ...saved } : defaultThemeSettings;
  } catch { return defaultThemeSettings; }
}
