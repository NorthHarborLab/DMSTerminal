# 开源隐私与历史边界

## 公开内容与私人定制

源码、文档、测试和默认配置仅使用示例域名及测试身份。私人部署配置优先保存在仓库外, 通过 `DSM_TERMINAL_ACCESS_CONFIG_SOURCE` 指定配置文件, 仅在构建时注入临时 payload; `.local/access.json` 也受 Git 忽略规则保护。带 `-private-` 的安装包即使已通过测试也不能公开, 普通源码检查不会自动证明所有旧包和附件已脱敏。本轮私人配置、定制包及旧 Git 备份均已移至仓库外, 不随源码同步。

本地可以在 `.local/privacy.json` 设置 `{"forbidden":["需要排除的字符串"]}`, 供发布检查使用。此文件不得提交, 不在公开脚本中硬编码个人信息黑名单。

也可将私人规则保存到仓库外, 用 `DSM_TERMINAL_PRIVACY_RULES` 指定绝对路径。显式指定的规则文件缺失或无效时检查失败, 不静默退回无私人规则的检查。

SPK 不携带 pnpm 的 `.modules.yaml` 或 `.pnpm-workspace-state-v1.json`, 避免分发其中的构建机目录。后端生产依赖、前端许可及项目 MIT 仍完整保留。

```text
pnpm check:publication
pnpm check:publication --staged
pnpm check:publication --staged --history
```

脚本检查文件名、候选或暂存内容、可选的本地分支/标签/远端跟踪可达历史, 包括作者、提交者和提交正文。它结合通用秘密模式与可用的本地隐私规则, 不是对未知个人信息、编码变体或全部秘密的形式化证明。没有本地规则的其他克隆只能执行通用检查。

历史改写过程中可用 `--history --ref <待验证的新提交>` 检查尚未更新到分支上的候选历史; 推送后仍须不带 `--ref` 核对全部拟公开分支、标签及远端跟踪引用。

## Git 身份与历史改写

维护者可为当前仓库配置中性项目署名与示例邮箱, 不修改其他仓库的全局设置。仅在文件中添加 mailmap 或删除最新文件不会消除旧 commit 的作者、邮箱或旧内容。

需要改写时先保留仓库外的私有恢复副本, 核对所有拟公开分支、标签和远端 SHA, 再改写对应提交的内容及作者/提交者字段。只推送经核对的分支, 用精确预期 SHA 的 force-with-lease 防止覆盖并发更新; 不把本地工具快照引用或私有备份镜像推送到 GitHub。

历史改写会改变提交哈希。其他克隆应重新克隆或按指导重新基线化, 不要合并旧历史, 否则可能重新引入已移除的信息。

本次最终选择重建: 先将旧 Git 元数据及恢复副本保存在仓库外的私有目录, 删除旧 GitHub 仓库, 然后建立全新的本地 Git 数据库与同名私有 GitHub 仓库。新 main 从不带父提交的匿名中文初始提交开始, 不复制旧 refs、reflog 或对象库。只上传经过隐私检查的源码, 不带旧历史、定制配置、安装包、日志和本地索引。

## GitHub 与日志检查

切换公开前独立检查 Actions 运行记录、日志、Artifacts、Releases、PR、Issue、附件和所有可见引用。源码提交不会清理这些服务端资源; 发现敏感内容时先保持私有并定位具体目标, 不进行无范围的删除。

本轮准备时 GitHub API 返回 Actions 运行数 0、Artifacts 0、Releases 0、PR 0、Issue 0; 因此这些集合中没有待检查的历史日志或附件。仓库可见性保持私有。私密漏洞报告入口是否可用未得到肯定确认, 使用 SECURITY.md 中说明的备用流程, 不向公开 Issue 附带敏感细节。

改写分支并强制推送只能清理分支可达历史, 不能保证擦除 GitHub 按旧 SHA 保留的对象、缓存、平台审计记录、其他克隆或 Fork。GitHub 账号、仓库所有者及操作主体也不是靠匿名 Git 作者即可隐藏的信息。需要彻底清除服务器残留时应按 GitHub 官方流程联系支持并协调其他副本, 在确认前不要把“分支已脱敏”表述为“全平台已彻底删除”。[GitHub 官方历史清理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

## 安全与开源是两项验收

MIT 与第三方声明见根目录 LICENSE 和 THIRD_PARTY_NOTICES.md。公开实验源码不等于批准生产部署; 真实 DSM 身份验证、升级与双用户隔离仍按 SECURITY.md 和安全边界文档验收。修复和测试不构成零风险承诺。
