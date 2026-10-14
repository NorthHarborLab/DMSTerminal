# 自动构建与发布

工作流文件为 `.github/workflows/build-spk.yml`，名称为 **Build DSM Terminal SPK**。它负责源码检查、测试、生成 SPK 和基于版本标签的 Release 发布。

## 触发方式

| 操作 | 结果 |
| --- | --- |
| 推送 main | 检查、测试、构建 SPK，保存 Actions artifact |
| 向 main 提交 PR | 构建安装包，不创建 Release |
| Run workflow 选择 main | 手动构建并保存 artifact |
| 推送 `v<DSM 套件版本>` 标签 | 构建成功后创建预发布 Release |
| Run workflow 选择已有版本标签 | 重新构建；不覆盖同名 Release |

artifact 仅包含通用 `.spk` 和同名 `.spk.sha256`，保留 14 天。Release 标记为 prerelease，不标记为 Latest。工作流不修改仓库可见性，产物读取权限由仓库与平台设置决定。

## 版本与发布

`packages/dsm/version.json` 是 DSM 套件版本的默认来源，格式为 `主版本-构建号`，例如 `0.2.3-0016`。主版本应与根 `package.json` 的 `version` 一致。

发布新包时：

1. 递增套件构建号，必要时同步更新主版本。
2. 将代码与版本修改提交、推送到 main。
3. 等待 main 构建成功。
4. 创建与版本文件完全一致的 `v` 前缀标签，再推送该标签。

```bash
git push origin main
package_version="$(node -p 'require("./packages/dsm/version.json").version')"
git tag "v$package_version"
git push origin "v$package_version"
```

每个版本标签只使用一次。标签必须指向 main 可达的提交，工作流会检查版本与标签的一致性，并在发布前再次核对标签提交 SHA。

发布任务先创建草稿并上传两个附件，全部成功后发布。如果中途失败留下草稿，应人工检查产物与错误原因；重跑不会自动删除或覆盖既有 Release。

## 本地构建

使用 Node.js `>=22.22.3` 和根 `packageManager` 指定的 pnpm：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:spk
pnpm check:release
```

产物位于 `release/`。SPK 构建会解包并独立启动服务，检查健康接口、DSM 鉴权要求、Web 资源路径、Origin 限制和可移植依赖。

`DSM_TERMINAL_VERSION` 可覆盖本地构建版本；自动 Release 则要求规范包名、INFO 和版本文件一致。

## 云端检查

CI 使用 Ubuntu 24.04、Node.js 22.23.3，以及根 `packageManager` 锁定的 pnpm。依赖通过冻结锁文件安装，随后执行源码与可达历史检查、类型检查、后端及发布测试、SPK 构建和发布包检查。

`pnpm check:release` 要求：

- 文件名为当前版本的规范通用包名。
- SHA256 与实际包内容一致，INFO 版本正确。
- 包内外部来源严格为 `https://nas.example.com`。
- 项目许可存在，包内不包含运行数据、密钥文件、环境文件或 pnpm 主机安装状态文件。
- 常见秘密模式与可用的私人排除词检查通过。

本地可通过 `DSM_TERMINAL_PRIVACY_RULES` 显式指定仓库外的私人排除词文件。不要将实际私人值上传到 Actions、日志或公开源码。扫描范围与限制见 [配置与发布隐私](OPEN_SOURCE_PRIVACY.md)。

## 权限与产物保护

构建任务只有 `contents: read`，checkout 不保存凭据，不共享依赖缓存，也不使用 `pull_request_target` 或跨工作流 `workflow_run`。Action 固定到完整提交 SHA。

仅版本标签的独立发布任务获得 `contents: write` 和读取 artifact 的权限。它不 checkout 或执行项目代码，只下载同次构建返回的确切 artifact ID，核对两个文件、摘要及标签 SHA，再创建 Release。不需要配置个人访问令牌或私人部署 secrets。

维护 Action 版本时，应核实官方仓库提交。相关原则见 [GitHub Actions 安全指南](https://docs.github.com/en/actions/reference/security/secure-use)。

## 安装与配置

通用包不包含实际 NAS 地址，首次部署应按 [外部访问配置](EXTERNAL_ACCESS.md) 设置自己的来源，或在本地构建私人包。升级保留已有 `access.json`。

安装、备份和排障见 [安装指南](../release/README.md)，维护者检查清单见 [发布指南](PUBLICATION.md)。
