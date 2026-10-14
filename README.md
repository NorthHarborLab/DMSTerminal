# DSM Terminal

DSM Terminal 是运行在群晖 DSM 中的 SSH 与 SFTP 工作台。在浏览器里管理服务器、打开交互式终端，并在终端旁浏览、上传和下载远程文件。

应用以 DSM 套件形式安装，使用 DSM 登录身份区分用户，支持加密保存连接凭据、多终端标签和可配置主题。

## 功能

- **SSH 终端**：基于 xterm.js，支持 PTY、ANSI、256 色、TrueColor、UTF-8、中文和交互程序；窗口大小与远程终端同步。
- **连接管理**：保存多台服务器配置，支持账号 + 密码、账号 + 私钥、账号 + 私钥 + 密码，以及私钥口令。
- **凭据保存**：按 DSM 用户隔离配置，在后端加密保存 SSH 账号和连接凭据；也可只在当前会话中使用，不保存密码或私钥。
- **主机指纹**：首次连接确认 SHA256 指纹，已保存指纹发生变化时拒绝连接。
- **传输回退**：优先使用 WebSocket，连接不可用时自动切换到 HTTPS 事件轮询；身份验证和指纹错误会直接提示。
- **文件管理**：终端与 SFTP 文件面板并排，支持详情列表、缩略图、图片与文本预览、目录导航、隐藏文件和排序。
- **文件操作**：流式上传与下载、拖放与多文件上传、上传进度与取消、覆盖确认、新建目录、重命名、删除和权限修改。
- **主题与布局**：六套内置深浅主题、自定义配色，以及适配手机的侧栏和文件视图。

## 安装

套件目标环境为 Synology DSM 7.2.2、`apollolake` / x86_64，参考设备为 DS218+。运行依赖群晖官方 **Node.js v22** 套件，版本至少为 `22.22.3-1010`。

1. 在 DSM 套件中心安装适配设备的 Node.js v22。
2. 从本仓库 **Releases** 下载 `.spk` 及同名 `.sha256` 文件，并校验安装包。
3. 在“套件中心 → 手动安装”中选择 SPK；继续前确认安装包来源。
4. 按 [外部访问配置](docs/EXTERNAL_ACCESS.md) 设置自己的 HTTPS 地址。
5. 启动 DSM Terminal，从配置地址登录 DSM，再通过 DSM 主菜单打开应用。

通用安装包使用 `https://nas.example.com` 作为示例地址，首次部署需要修改套件数据目录中的 `access.json`，或使用自己的配置在本地构建安装包。升级会保留已有配置。

安装、升级、备份与故障处理见 [安装指南](release/README.md)。

## 使用

### 连接服务器

添加服务器地址、SSH 端口、账号和认证方式。可以选择加密保存凭据，也可以在连接时临时输入。首次连接时，应通过可信渠道核对远程服务器的主机指纹。

服务器配置和保存凭据按 DSM 用户管理。修改主机、端口、账号或认证方式后，需要重新保存连接凭据；修改主机或端口还会清除旧指纹。

### 管理文件

连接后打开文件面板，浏览目标 SSH 服务器的 SFTP 目录。在详情和缩略图视图间切换，选中文件查看属性或预览，使用工具栏上传、下载及管理文件。

- 文件操作遵循远程 SSH 账号权限，不限于 home 目录，也不绕过服务器权限。
- 单文件上传上限为 1 GiB，不支持断点续传。
- 支持普通文件和空目录删除，不递归删除非空目录。
- 文本预览读取前 256 KiB；PNG、JPEG、GIF、WebP 图片预览上限为 8 MiB。
- 下载交由浏览器处理，上传任务在文件面板显示进度。

### 保存与备份

套件数据目录中的 `profiles.json` 保存服务器配置，`credentials.key` 保存解密所需的主密钥。备份和恢复时必须同时保留这两个文件；丢失主密钥后无法恢复保存的凭据。

密码和私钥不会写入浏览器持久存储，主题设置保存在当前浏览器。部署方式、加密机制和权限范围见 [部署与凭据保护](docs/SECURITY_BOUNDARIES.md)。

## 本地开发

需要 Node.js `>=22.22.3`，pnpm 版本由根目录 `package.json` 的 `packageManager` 字段指定。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发地址：

- 前端：<http://127.0.0.1:4173>
- 后端：<http://127.0.0.1:4174>

开发服务使用本地开发身份，只允许回环访问，不应通过反向代理暴露到公共网络。

### 本地 SSH 示例

```bash
pnpm --filter @dsm-terminal/server mock:ssh
```

示例服务监听 `127.0.0.1:22222`，账号为 `demo`，密码为 `dsm-terminal-demo`，每次启动生成临时主机密钥。这组凭据仅用于本地示例，不应复用于实际服务器。

### 检查与构建

```bash
pnpm typecheck
pnpm test
pnpm package:spk
pnpm check:release
```

前后端构建输出分别位于 `apps/web/dist` 和 `apps/server/dist`。SPK 与 SHA256 文件位于 `release/`，套件版本由 `packages/dsm/version.json` 指定。

GitHub Actions 会在推送 main、提交 PR 或手动触发时构建安装包；推送匹配版本的标签后创建预发布 Release。详见 [自动构建与发布](docs/BUILD_RELEASE.md)。

## 项目结构

```text
apps/
├── server/         DSM 认证、SSH、WebSocket / HTTP、凭据存储与 SFTP API
└── web/            React、TypeScript、xterm.js 与文件管理界面
packages/dsm/       套件配置、Nginx 代理、启动脚本与 SPK 构建工具
scripts/            源码和发布包检查、版本工具及发布测试
docs/               配置、部署与发布文档
release/            安装指南及本地构建产物
.github/workflows/  自动测试、构建与 Release 工作流
```

## 文档

- [安装、升级与故障处理](release/README.md)
- [外部访问地址配置](docs/EXTERNAL_ACCESS.md)
- [部署与凭据保护](docs/SECURITY_BOUNDARIES.md)
- [自动构建与发布](docs/BUILD_RELEASE.md)
- [发布指南与检查清单](docs/PUBLICATION.md)
- [配置与发布隐私](docs/OPEN_SOURCE_PRIVACY.md)
- [安全政策与漏洞报告](SECURITY.md)

## 许可证

项目代码使用 [MIT](LICENSE) 许可证。第三方依赖保留各自的许可证和版权声明，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
