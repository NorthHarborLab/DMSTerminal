---
name: DSM Terminal
description: 可配置主题的 SSH / SFTP 工作台
colors:
  background: "#090c10"
  panel: "#0e1319"
  raised: "#182129"
  foreground: "#e7efeb"
  muted: "#9caab2"
  line: "#303d46"
  accent: "#70f7b0"
  danger: "#ff8c8c"
  ocean-background: "#0c1521"
  ocean-panel: "#111e2e"
  ocean-raised: "#1b2c40"
  ocean-foreground: "#e4edf9"
  ocean-muted: "#a3b4ca"
  ocean-line: "#344a65"
  ocean-accent: "#75beff"
  ocean-danger: "#ff9090"
  amber-background: "#18140f"
  amber-panel: "#211b14"
  amber-raised: "#33291e"
  amber-foreground: "#f5ecdb"
  amber-muted: "#c0b49f"
  amber-line: "#554534"
  amber-accent: "#ffd18b"
  amber-danger: "#ff9790"
  violet-background: "#16131f"
  violet-panel: "#201b2c"
  violet-raised: "#30283f"
  violet-foreground: "#eee8f8"
  violet-muted: "#b8accd"
  violet-line: "#4c3f61"
  violet-accent: "#cbb1ff"
  violet-danger: "#ff94a8"
  paper-background: "#f7f9fc"
  paper-panel: "#edf1f6"
  paper-raised: "#ffffff"
  paper-foreground: "#202d3d"
  paper-muted: "#52647a"
  paper-line: "#bdc9d8"
  paper-accent: "#1762a5"
  paper-danger: "#b3233b"
  graphite-background: "#17191d"
  graphite-panel: "#202329"
  graphite-raised: "#2c3038"
  graphite-foreground: "#eceff4"
  graphite-muted: "#afb7c4"
  graphite-line: "#464e5c"
  graphite-accent: "#b8d4ee"
  graphite-danger: "#ff9292"
  on-accent-dark: "#101820"
  on-accent-light: "#ffffff"
typography:
  display:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "clamp(25px, 3vw, 39px)"
    lineHeight: 1.3
    letterSpacing: "-.02em"
  title:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "20px"
    lineHeight: 1.4
  body:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "12px"
  label:
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "10px"
  terminal:
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace"
    fontSize: "14px"
    lineHeight: 1.18
  file-code:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "11px"
    lineHeight: 1.7
rounded:
  control: "5px"
  button: "6px"
  server: "7px"
  notice: "9px"
  modal: "10px"
spacing:
  tight: "4px"
  small: "8px"
  field: "10px"
  panel: "12px"
  button-inline: "16px"
  backdrop: "18px"
  dialog: "23px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent-dark}"
    rounded: "{rounded.button}"
    padding: "7px 16px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    padding: "7px 16px"
  button-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.danger}"
    rounded: "{rounded.button}"
    padding: "7px 16px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  session-tab:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
  server-card:
    rounded: "{rounded.server}"
    textColor: "{colors.foreground}"
  credential-badge:
    textColor: "{colors.accent}"
  theme-option:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "7px"
  file-details:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
  file-tile:
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "9px 6px"
---

# Design System: DSM Terminal

## Overview

**Creative North Star: "终端与文件, 在同一个工作台"**

DSM Terminal 继承紧凑服务器侧栏、终端标签和深色面板, 使用强调色标识当前操作与连接状态。工作区服务于 SSH 与 SFTP 的连续操作, 颜色可以切换, 组件几何保持一致。

界面以文字、细边框和表面明度组织信息。文件详情、文本或图片预览在当前目录内展开; 保存凭据采用明确选择和状态提示, 不在界面回显保存的密码或私钥。

**Key Characteristics:**

- 紧凑的任务工作区与可滚动局部面板
- 六个内置主题和同步的界面/终端配色
- 目录内选择、详情和预览
- 可见的键盘焦点与操作状态

本文件从当前实现提取, 不定义新的品牌隐喻。数值以前置 token 和源码为准; 主题变量由应用根容器提供, 并非全局 `:root` 声明。

## Colors

### Primary

默认强调色为薄荷绿, 用于主要按钮、活动标签顶线、连接成功标识、选中文件名与焦点轮廓。危险操作使用独立的危险色和可读文案。

### Neutral

背景、面板、抬高表面、正文、辅助文字和分隔线形成三层表面与两级文字。前置无前缀颜色对应默认薄荷深夜; 其他前缀与 `src/themes.ts` 的内置主题 ID 对齐。

六个内置主题为薄荷深夜、深海蓝、琥珀暖夜、暮色紫、明亮纸白和石墨灰。明亮纸白采用浅表面和蓝色强调色。主要按钮文字从 `on-accent-dark` 与 `on-accent-light` 中选较高对比度者, 前置组件示例记录默认深色主题。

自定义仅编辑强调色、背景色、文字色; 面板、抬高表面、辅助文字和边框由混色推导。主题设置检查正文、辅助文字与强调色相对三个表面的对比度 (4.5:1), 不足时显示错误并禁用应用按钮。终端 ANSI 色有独立浅/深色方案, 不等于界面语义颜色。

**The Semantic Theme Rule.** 组件跟随当前主题的语义角色; 切换主题不改变组件几何和信息层级

## Typography

界面采用中文无衬线字体栈; 主机地址、路径、私钥和文本预览采用等宽字体。字体名表示回退顺序, 不表示项目已打包对应字体文件。

欢迎标题使用 display 角色, 手机降为 (26px)。对话框标题使用 title 角色。常规操作与字段使用 body 角色, 文件元数据和状态栏使用 label 角色。服务器名称为 (13px, 600), 品牌名称为 (15px), 主要按钮为 (12px, 600)。终端采用 terminal 角色; 文本预览采用 file-code 角色。详情表的数值启用等宽数字。

## Layout

桌面采用左侧服务器栏和右侧工作区。侧栏宽 (250px), 工作区依次为标签栏 (42px)、工具栏 (40px)、可伸缩内容区和状态栏 (27px)。文件开启时, 终端与文件并排; 文件宽采用 `clamp(360px, 39vw, 600px)`。文件列表独立滚动, 详情区最多占面板高度的 (44%), 上传任务区最高 (170px)。

宽度不超过 (1000px) 时侧栏收至 (215px), 文件固定为 (360px)。不超过 (760px) 时侧栏改为带遮罩的抽屉, 宽 `min(285px, 86vw)`; 文件开启后占工作区, 终端隐藏, 收起文件后回到终端。工具栏保留服务器和主题入口。详情元数据从四列变为两列。

详情列表列宽依次为 (44% / 17% / 25% / 14%), 名称可截断。缩略图使用自适应网格, 最小列宽 (100px), 间距 (8px), 图像区域高 (70px)。图片保持完整比例, 不裁切成固定封面。

## Elevation & Depth

工作区主要依靠表面明度和细边框组织层次。常驻列表、工具栏和详情区没有卡片投影。终端通知使用 `0 16px 44px #0005` 阴影; 模态使用 `0 25px 80px #0006` 阴影和 `#0008` 遮罩。侧栏抽屉也使用遮罩。

连接中的状态点以 (1.2s) 周期脉冲, 中点透明度为 (.45)。减少动态效果偏好将动画压缩至 (.01ms) 且只运行一次。按钮悬停通过颜色、边框或亮度表达, 当前 CSS 没有过渡动画 token。

## Shapes

控件、按钮、服务器条目、通知与对话框使用前置圆角角色。边框通常为 (1px), 状态点为圆形。普通键盘焦点轮廓为强调色 (2px), 外偏移 (2px)。详情表采用水平分隔, 终端和文件区域采用直接的面板分隔。

## Components

按钮: 主要按钮用于连接、确认、应用主题; 悬停亮度为 (1.08)。次要按钮为抬高表面和细边框, 悬停边框转辅助文字色。危险按钮使用面板色与危险文字。紧凑变体高至少 (29px), 内边距 (4px 9px), 字号 (11px); 普通变体高至少 (37px)。禁用透明度为 (.5), 保留禁用光标。

字段: 深浅主题均跟随背景、正文和边框角色。占位符使用辅助文字色, 光标使用强调色。模态字段具有明确标签; 私钥输入采用等宽文本区。错误文字使用危险色, 校验结果不只靠颜色表达。

服务器条目与凭据标记: 条目悬停或焦点进入时显示边框与抬高表面。名称和连接地址可截断; 已保存凭据以钥匙图标和文字标识。保存动作由选择框或保存方式字段明确触发, 已保存的秘密不回显。

会话导航: 活动标签以背景层、正文色和顶端强调线区分。标签宽 (155–220px), 横向可滚动; 连接、连接中、错误和关闭由状态点表现, 关闭有独立按钮。

主题选项: 六个选项组成三列网格, 每个展示自身的终端背景、文字和强调色。选中项采用强调色边框和 (1px) 外轮廓, 通过 `aria-pressed` 表达状态。草稿终端预览与应用结果共用主题解析。

文件列表与缩略图: 名称、大小、修改时间和权限构成详情列。行和图块均具有悬停、选中与键盘焦点。选中条目在当前目录展示元数据与预览; 双击或 Enter 打开目录, 详情行 Space 选择。缩略图仅对可见的小图片尝试加载, 不可用时显示类型图标。

文件详情与传输: 文本预览保持等宽排版, 图片使用 contain。操作包括下载、重命名、权限和删除, 加载/错误分别有文字反馈。上传任务显示文件名、进度及完成/取消/错误结果; 下载交由浏览器处理。空目录、无匹配、文件服务连接与指纹确认各有独立状态。

对话框: 标题、说明、字段/选项、反馈与右对齐动作保持同一结构。当前实现包含焦点圈定、Escape 关闭和关闭后还原焦点; 遮罩点击也可关闭, 连接与保存处理中有相应禁用约束。普通模态宽 `min(480px, 100%)`, 连接模态为 `min(520px, 100%)`, 内容超出可滚动。

## Do's and Don'ts

### Do:

- Do 使用当前主题的语义变量, 同步界面与终端配色
- Do 保留字段标签、图标按钮的可访问名称与可见焦点
- Do 用选中状态和详情区表达文件选择, 用文字区分传输结果
- Do 在小屏保持服务器、主题和文件入口可达

### Don't:

- Don't 为单个面板固定另一套主题色或改变主题间的组件几何
- Don't 把保存凭据默认设为勾选, 或回显已经保存的密码与私钥
- Don't 把浏览器下载描述成已有上传式进度条的内部传输队列
- Don't 把测试截图中的棋盘格当作品牌插画或产品背景

提取依据: `src/styles.css`、`src/themes.ts`、`src/App.tsx`、`src/FilePane.tsx`、`src/TerminalPane.tsx`、主题/连接/服务器/凭据组件与 `useDialog.ts`; 对照 `.impeccable/review/` 的桌面详情、缩略图、浅色、手机文件与手机主题截图。棋盘格只用于预览测试。
