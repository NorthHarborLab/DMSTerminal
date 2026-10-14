# 发布指南与检查清单

本文面向维护者，说明提交源码、生成安装包和发布附件时需要检查的内容。自动化触发方式与版本标签规则见 [自动构建与发布](BUILD_RELEASE.md)。

## 版本与构建

1. 在 `packages/dsm/version.json` 中更新套件版本；主版本与根 `package.json` 保持一致。
2. 使用根 `packageManager` 指定的 pnpm 和锁文件安装依赖。
3. 完成类型检查、测试、SPK 构建与发布包检查。
4. 确认文档中的依赖、文件名和安装步骤与产物一致。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm audit
pnpm package:spk
pnpm check:release
```

SPK 构建会解包并独立启动后端，检查健康接口、未认证请求拒绝、Web 资源、Origin 限制和可移植依赖。面向目标设备发布时，还应验证安装、启动、停止、升级和数据保留，以及 DSM 登录、退出和不同用户之间的访问隔离。

## 源码与提交检查

- 只使用示例地址、演示身份和经过确认的测试数据。
- 不提交真实账号、密码、私钥、访问令牌、私人部署配置或日志。
- 不提交 `profiles.json`、`credentials.key` 等运行数据，即使其中内容已经加密。
- 不提交依赖目录、本地索引、测试截图、私人包或旧仓库备份。
- 核对提交作者、邮箱、提交正文、标签和全部拟发布引用中的个人信息。
- 审阅暂存 diff，确认没有无关改动。

```bash
git diff --cached --check
pnpm check:publication --staged --history
```

私人排除词应保存在仓库外，通过 `DSM_TERMINAL_PRIVACY_RULES` 传入检查进程。规则用法和历史信息处理见 [配置与发布隐私](OPEN_SOURCE_PRIVACY.md)。

## 安装包与附件检查

- 通用包仅包含示例外部来源 `https://nas.example.com`。
- 私人定制包使用 `-private-` 文件名，不作为通用 Release 附件。
- 检查 SPK 解包内容，不以源码检查或文件名代替产物检查。
- 保留项目 MIT、第三方声明、前端完整许可和后端依赖许可。
- 附件只包含预期的 SPK 和同名 SHA256 文件，校验值与实际下载内容一致。
- 检查 Actions 日志、Artifacts、Release 说明、Issue、PR 及附件，避免通过源码以外的渠道分发私人信息。

通用包检查使用 `pnpm check:release`。要对包内容额外应用私人排除词，需要显式设置 `DSM_TERMINAL_PRIVACY_RULES`。

## 功能检查

- 正常 DSM 登录能够建立应用会话，无效认证和重放请求被拒绝。
- 不同用户的配置、保存凭据及终端和文件会话保持隔离。
- SSH 主机指纹确认、变化拦截和错误提示符合预期。
- WebSocket 可用时正常连接；不可用时 HTTP 回退可用，弃用会话能够回收。
- 上传、下载、取消、覆盖确认、预览和文件操作遵循远程账号权限。
- 升级保留 `profiles.json`、`credentials.key` 和管理员的 `access.json`。

## 提交与发布

使用中文提交消息和项目中性署名，推送前核对目标仓库与分支。推送后确认本地和远端提交一致，再按 [版本标签流程](BUILD_RELEASE.md#版本与发布) 发布。

创建 Release、推送代码和修改仓库可见性是独立操作。公开仓库或调整访问权限前，应重新检查当时的源码、引用、日志与附件。
