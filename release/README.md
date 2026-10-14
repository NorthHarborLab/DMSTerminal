# 安装、升级与故障处理

## 环境要求

- 套件目标平台：Synology DSM 7.2.2，`apollolake` / x86_64；参考设备为 DS218+。
- 运行依赖：群晖官方 Node.js v22，版本至少 `22.22.3-1010`。
- 访问方式：通过配置的 HTTPS 地址登录 DSM，从主菜单进入应用。

## 安装

1. 在套件中心安装适配设备的 Node.js v22。
2. 从本仓库 Releases 下载 SPK 和同名 SHA256 文件。
3. 校验文件完整性，确认安装包来源。
4. 打开“套件中心 → 手动安装”，选择 SPK，并按提示完成安装。
5. 设置外部访问地址，启动 DSM Terminal，再从 DSM 主菜单打开。

以 `0.2.3-0016` 为例，校验命令为：

```bash
sha256sum -c DSM-Terminal-0.2.3-0016-apollolake.spk.sha256
```

安装包未附带群晖官方签名，DSM 可能显示第三方套件提示。不要安装来自不可信来源的包，也不要关闭系统检查来绕过来源确认。

## 外部地址

通用包仅包含示例 `https://nas.example.com`。首次启动会在套件数据目录初始化 `access.json`，管理员应将其中的 `externalUrl` 改为自己的 HTTPS 来源，或使用私人配置在本地重新构建包。

套件数据目录通常可通过 `/var/packages/DSMTerminal/var/` 访问。修改配置后，在套件中心停止并重新启动应用，再从配置地址登录 DSM。

来源不包含应用路径、查询参数或通配符。不同域名、HTTP 来源和未配置端口不会自动放行。完整操作见 [外部访问配置](../docs/EXTERNAL_ACCESS.md)。

## 升级与备份

升级前备份：

- `profiles.json`：服务器配置和加密凭据。
- `credentials.key`：解密凭据所需的主密钥。
- `access.json`：管理员设置的外部访问地址。

这几个文件均位于套件数据目录，升级会保留已有文件。恢复凭据时必须使用配套的 `profiles.json` 与 `credentials.key`。不要重建或删除主密钥来处理启动问题。

升级完成后关闭旧应用窗口，从 DSM 主菜单重新打开；旧快捷方式失效时也按此方式进入。远程服务器上的文件不会因套件升级而被迁移。

## 常见问题

### 无法启动

确认 Node.js v22 套件已安装并运行，版本符合要求。检查 `access.json` 是否为有效 JSON、URL 是否符合 HTTPS Origin 格式，以及套件数据目录权限是否正确。

### 页面资源返回 403

检查浏览器访问地址是否与 `access.json` 一致，包括端口。外层代理应保留正确的 Host；使用非默认端口时保留 `$http_host` 中的端口。修改配置后重启套件。

### 无法完成 DSM 身份认证

重新从配置地址登录 DSM 并打开应用。检查套件进程能否执行官方认证助手，以及会话交换路径是否转交了必要 Cookie 和 SynoToken。不要将鉴权模式改为 development 来绕过认证。

### 服务器指纹变化

先通过可信渠道核对远程 SSH 服务器是否更换主机密钥，再更新配置。不要在不确认来源时直接接受变化。

## 收集日志

具备 SSH 权限的管理员可以执行：

```bash
sudo synopkg status DSMTerminal
sudo tail -n 200 /var/log/packages/DSMTerminal.log
sudo tail -n 200 /var/packages/DSMTerminal/var/dsm-terminal.log
sudo tail -n 200 /var/log/synopkg.log
```

反馈问题时说明套件版本、DSM 版本、设备型号、安装或升级步骤及错误信息。无法 SSH 登录时，可以提供套件中心的提示和已脱敏截图。

日志可能包含服务器地址、配置 ID 或个人目录。分享前移除这些内容，不要提交 Cookie、SynoToken、Authorization、密码、私钥或完整票据 URL。漏洞报告使用 [SECURITY.md](../SECURITY.md) 中的渠道。
