# 自动构建与测试版发布

工作流: `.github/workflows/build-spk.yml`, 名称为 **Build DSM Terminal SPK**。仓库可见性不由工作流修改; 私有仓库中的 Actions 产物和 Release 仍需仓库访问权限。

## 触发方式

| 操作 | 结果 |
| --- | --- |
| 推送 main | 检查、测试、构建 SPK, 保存 Actions artifact |
| 向 main 提交 PR | 同样构建, 不创建 Release, 不授予写权限 |
| Actions 中 Run workflow, 选择 main | 手动构建并保存 artifact, 不发布 |
| 推送 `v<DSM 套件版本>` 标签 | 构建成功后发布测试版 Release |
| Run workflow 选择已有版本标签 | 使用该标签重新构建; 已有 Release 不会被覆盖 |

产物只包含通用 `.spk` 和同名 `.spk.sha256`, artifact 保留 14 天。Release 为 prerelease, 不标记为 Latest。发布任务先创建草稿并上传文件, 全部成功后才公开为仓库内可见的测试版。若上传中断留下草稿, 请先人工检查, 不自动覆盖或删除既有 Release。

## 版本与发布

`packages/dsm/version.json` 是 DSM 套件版本的默认来源, 当前为 `0.2.3-0016`; 主版本必须与根 `package.json` 的 `version` 一致。`DSM_TERMINAL_VERSION` 仍可用于本地定制构建, 但自动 Release 只接受受版本文件约束的通用包。

更新套件时递增末尾构建号, 先将修改提交到 main, 再推送与版本完全一致的标签:

```bash
git push origin main
git tag v0.2.3-0016
git push origin v0.2.3-0016
```

该示例版本只能发布一次, 后续发布必须更新版本文件和标签。标签须指向 main 中的提交, 工作流会核对版本、标签及提交身份, 不从任意分支发布。Git 署名继续使用项目中性身份, 避免在提交或附注标签中写入个人信息。

发布后下载两个附件并运行:

```bash
sha256sum -c DSM-Terminal-0.2.3-0016-apollolake.spk.sha256
```

## 构建门禁

使用 Ubuntu 24.04、Node.js 22.23.3 和根 `packageManager` 锁定的 pnpm, 通过冻结锁文件安装。按顺序检查源码与可达历史、类型、13 项后端回归及 3 项发布测试, 然后构建 SPK。打包会解包独立启动服务, 检查健康、未认证请求拒绝、浏览器资源、Origin 限制和可移植依赖。

`pnpm check:release` 校验文件名、SHA256、INFO 版本及许可, 并要求包内外部地址严格为 `https://nas.example.com`。扫描解包文件以拒绝运行数据、密钥文件、环境文件、pnpm 主机元数据及常见凭据模式; `ssh2/test` 中的上游测试夹具不分发。本地可额外通过仓库外的 `DSM_TERMINAL_PRIVACY_RULES` 指定私人排除词, 但这些值不得上传至 Actions、日志或源码。自动扫描不能证明所有未知秘密或个人信息均不存在。

本地检查:

```bash
pnpm typecheck
pnpm test
pnpm package:spk
pnpm check:release
```

## 权限与隐私边界

构建任务只有 `contents: read`, 不保留 checkout 凭据, 不使用 `pull_request_target` 或跨工作流 `workflow_run`。Action 固定完整提交 SHA, 不共享依赖缓存。仅版本标签的发布任务获得 `contents: write` 和读取同一运行 artifact 的权限; 它不 checkout 或执行项目代码, 不需要配置个人访问令牌或私人部署 secrets。写权限仅用于创建草稿、上传两个已校验附件和发布测试版。

权限和固定 SHA 的设计参考 [GitHub Actions 安全指南](https://docs.github.com/en/actions/reference/security/secure-use)。以后更新 Action 时应重新核实官方仓库提交, 不直接替换成可移动标签。

通用包不包含实际 NAS 地址, 首次部署需要按 [外部访问说明](EXTERNAL_ACCESS.md) 配置或在本地构建私人包; 升级保留已有 `access.json`。创建 Release 不等于将仓库改为公开, 更不代表真实 DSM 安装、官方认证助手权限或双用户隔离已经验收。生产验收边界保持 [SECURITY_BOUNDARIES.md](SECURITY_BOUNDARIES.md) 中的约束。
