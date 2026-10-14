# DSM Terminal 测试安装

目标设备：Synology DS218+（apollolake / x86_64）
目标系统：DSM 7.2.2-72806 Update 10

## 安装

1. 在 DSM 套件中心安装群晖官方 **Node.js v22**, 版本至少 `22.22.3-1010`。新版不再使用 v20, 也不会自动升级 DSM。
2. 打开“套件中心 → 手动安装”。
3. 选择适配自己外部地址的 `DSM-Terminal-0.2.3-0016-apollolake.spk`; 本地定制包的文件名额外带有 `-private-`。
4. DSM 会提示这是第三方未签名套件；确认文件来自本项目后继续。
5. 启动 DSM Terminal，然后从 DSM 主菜单打开。

当前测试版在应用入口配置中设置了 `allUsers: false`, 但后端没有明确的 `administrators` 组校验, 不能仅凭入口可见性承诺管理员独占访问。已实施三项已知问题的代码修复; 真实 DSM 的安装、升级、官方认证助手权限和双用户隔离仍待验收, 暂不作为安全完成版本发布; 参见 [安全边界](../docs/SECURITY_BOUNDARIES.md)。

群晖官方下载中心当前对 DS218+ / DSM 7.2.2 返回 Node.js v22 `22.22.3-1010`; 这是可下载性证据, 不代表本套件已在目标 NAS 安装成功。[官方机型下载信息](https://www.synology.com/api/support/findDownloadInfo?lang=en-us&product=DS218%2B&major=7&minor=2&micro=2)

升级前备份套件数据目录中的 `profiles.json` 和 `credentials.key`, 必须同时保留。升级后关闭旧窗口并从 DSM 主菜单重新打开, 不沿用旧页面的认证流程。若无法 SSH 登录 NAS, 可以先用套件中心手动安装并反馈安装/启动提示及应用中的认证错误; 不要发送真实 Cookie、SynoToken、密码或私钥。

首次启动自动创建 `access.json`。公开源码包只含示例地址 `https://nas.example.com`, 安装前应使用自己的配置重新构建; 私人定制包保留构建时注入的真实地址, 不纳入源码提交或公开 Release。在配置域名登录 DSM 并打开应用, 可使用外层 HTTPS -> DSM HTTP 5000 的转发方式。其他域名、HTTP 来源及未配置端口不被允许。升级保留既有 `access.json`, 配置详情见 [外部访问说明](../docs/EXTERNAL_ACCESS.md)。

## 校验文件

```bash
sha256sum -c DSM-Terminal-0.2.3-0016-apollolake.spk.sha256
```

## 出错时收集信息

通过 SSH 登录群晖后执行：

```bash
sudo synopkg status DSMTerminal
sudo tail -n 200 /var/log/packages/DSMTerminal.log
sudo tail -n 200 /var/packages/DSMTerminal/var/dsm-terminal.log
sudo tail -n 200 /var/log/synopkg.log
```

把输出发回开发聊天即可继续定位。日志可能包含服务器地址或用户名，发送前可以自行遮盖。
