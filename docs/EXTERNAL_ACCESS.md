# 外部访问地址配置

## 当前套件预设

公开源码的预设外部地址为示例 `https://nas.example.com`, 应用 URL 为 `https://nas.example.com/3rdparty/DSMTerminal/`。这是文档示例, 不是可直接使用的真实 NAS 地址。部署前必须替换为自己的 HTTPS 来源, 或在构建时注入本地配置。

首次启动将包内 `config/access.json` 复制到套件数据目录 `/var/packages/DSMTerminal/var/access.json` (当前机型通常对应 `/volume1/@appdata/DSMTerminal/access.json`)。已有文件不覆盖, 因此升级不会改掉管理员设置。

```json
{
  "externalUrl": "https://nas.example.com"
}
```

此地址是严格的 HTTPS Origin, 只包含协议、主机和可选端口; 不填写应用路径、查询参数、账号密码或通配符。根目录尾斜杠与默认 443 端口会规范化。

## 为什么需要它

当前部署为浏览器 HTTPS -> 外层 Nginx -> DSM HTTP 5000 -> 套件 Node。DSM 的 `$scheme` 是最后一跳 HTTP, 因此仅凭 `X-Forwarded-Proto` 推导浏览器来源会将正确的 HTTPS 模块请求拒绝为 403。

配置存在时, HTTP 请求的 Origin 必须与配置规范化后的来源完全一致, 不再由最后一跳协议推导允许来源。DSM 认证助手的外部 HTTPS 环境也由这项可信配置确定, 而非调用者提供的转发头。不同域名、HTTP 来源、未配置端口和 `Origin: null` 仍被拒绝。此配置不提供 CORS 放行, 也不替代 DSM 身份验证、bearer token、用户隔离或一次性票据。

无 Origin 的服务端/健康检查请求仍可访问公开页面和 health, 但受保护 API 仍要求应用 bearer。WebSocket 仍要求有效一次性终端票据。此配置不会给内网 HTTP 链路加密, 不会修改外层 Nginx, 也不会关闭任何证书检查。

## 修改与故障处理

定制包可通过进程环境 `DSM_TERMINAL_ACCESS_CONFIG_SOURCE` 指向未提交的 `.local/access.json`, 同时设置 `DSM_TERMINAL_VARIANT=private` 再执行 `pnpm package:spk`。构建只覆盖临时 payload 中的配置, 不改写公开源码默认值; 产物文件名带 `-private-`, 不得上传为公开附件。`.local/`、SPK、校验文件和运行数据均被 Git 忽略。

从旧版升级时, 套件包名和数据目录保持 `DSMTerminal`; 应用入口标识改用中性项目命名。旧桌面快捷方式如失效, 请关闭旧窗口并从 DSM 主菜单重新打开, 不要删除凭据数据来排障。

由具备套件数据目录权限的管理员编辑 `access.json`, 保存后在套件中心停止并启动 DSM Terminal。没有网页端修改接口, 不允许普通 HTTP 请求改变全局信任来源。

例如改用 `https://nas.example.com:8443`, 必须同时在外层代理保留含端口的 Host (使用 `$http_host`, 而非丢弃端口的 `$host`), 并从该地址登录 DSM。单一外部来源配置不会同时允许两个端口或局域网 IP。

缺失配置会在套件启动时按包内预设初始化; 配置已有但 JSON、字段或 URL 无效时拒绝启动, 不降级为任意来源。修正后再启动。仅恢复外部地址配置不需要删除 `profiles.json` 或 `credentials.key`。

直接运行后端时, 可使用可信进程环境 `DSM_TERMINAL_ACCESS_CONFIG` 指定 JSON 文件, 或 `DSM_TERMINAL_EXTERNAL_URL` 指定单一 HTTPS 来源; 显式环境地址优先于文件。未提供两者时保留原来的请求协议/Host 同源检查。生产鉴权模式和开发回环限制不因外部地址配置而改变。

## 验证范围

回归覆盖 HTTPS Origin 经 HTTP 最后一跳加载 JS、正常替身身份交换、错误来源拒绝、配置失败关闭及 SPK 解包运行。真实 DSM 官方认证助手权限和真实用户隔离仍需 NAS 验收; 解决 JS 403 不代表全部部署验证完成。
