# 外部访问地址配置

## 配置文件

DSM Terminal 使用单一 HTTPS Origin 识别允许的浏览器来源。源码和通用安装包的默认值为示例 `https://nas.example.com`，部署时需要替换为自己的地址。

```json
{
  "externalUrl": "https://nas.example.com"
}
```

配置位于套件数据目录的 `access.json`，可通过 `/var/packages/DSMTerminal/var/access.json` 访问。首次启动从包内默认配置初始化，升级不覆盖已有文件。

`externalUrl` 只填写协议、主机和可选端口，不包含应用路径、查询参数、账号密码或通配符。根路径尾斜杠与默认 443 端口会被规范化。

例如，应用完整地址为 `https://nas.example.com/3rdparty/DSMTerminal/` 时，配置仍填写 `https://nas.example.com`。

## 修改地址

1. 由具备套件数据目录权限的管理员编辑 `access.json`。
2. 将 `externalUrl` 设置为浏览器实际使用的 HTTPS 来源。
3. 在套件中心停止并重新启动 DSM Terminal。
4. 从该地址登录 DSM，再通过主菜单打开应用。

没有网页端修改全局来源的接口。不要删除 `profiles.json` 或 `credentials.key` 来修复外部地址问题。

配置文件缺失时按包内默认值初始化；JSON、字段或地址无效时拒绝启动，不自动允许任意来源。

## 反向代理

浏览器可以通过外层 HTTPS 代理连接到 DSM 的 HTTP 或 HTTPS 端口。应用按管理员配置的来源检查请求，不以最后一跳连接协议或任意转发头推导浏览器信任来源。

- 保留正确的 Host；使用非默认端口时应保留 `$http_host` 中的端口。
- WebSocket 代理需要转交 Upgrade 和 Connection，终端也支持 HTTP 事件轮询回退。
- 从 `https://nas.example.com:8443` 访问时，配置必须包含 `:8443`。
- 不同域名、HTTP 来源、未配置端口和 `Origin: null` 不会自动放行。
- 单一配置不会同时允许多个域名、端口或局域网 IP。

这项配置不提供跨域 CORS 放行，不替代 DSM 身份认证、应用 bearer 或连接票据，也不负责加密代理之间的内部链路。TLS、证书与外层代理访问策略由部署环境管理。

无 Origin 的页面及健康检查请求仍可访问相应公开资源；受保护 API 和 WebSocket 仍需要各自的应用身份或票据。

## 本地定制包

将真实部署配置保存到仓库外，或放在被忽略的 `.local/access.json` 中。构建时指定该文件并设置私人变体：

```bash
DSM_TERMINAL_ACCESS_CONFIG_SOURCE=/path/to/private/access.json \
DSM_TERMINAL_VARIANT=private pnpm package:spk
```

构建只覆盖临时 payload 中的配置，不修改源码默认值。生成的包名带 `-private-`，应仅用于对应部署，不上传为通用附件。详细规则见 [配置与发布隐私](OPEN_SOURCE_PRIVACY.md)。

## 直接运行后端

直接运行 Node 后端时，可以通过可信进程环境配置：

| 环境变量 | 用途 |
| --- | --- |
| `DSM_TERMINAL_ACCESS_CONFIG` | 指定外部地址 JSON 文件 |
| `DSM_TERMINAL_EXTERNAL_URL` | 直接指定单一 HTTPS 来源，优先于文件 |

均未设置时，后端按请求协议与 Host 检查同源。直接运行仍需正确选择认证模式；地址配置不改变生产鉴权或开发模式的回环限制。

## 故障排查

页面资源返回 403 时，先检查浏览器来源和配置是否一致，包括协议、域名及端口，再检查代理 Host 与重启后的配置。

地址正确但认证失败时，另行检查 DSM 登录状态、会话交换请求和官方认证助手权限。相关命令见 [安装与故障处理](../release/README.md)。
