# 配置与发布隐私

## 内容分类

源码、默认配置、文档和示例使用示例域名及演示身份。真实部署地址、账号、认证材料和运行数据保存在管理员控制的位置，不随源码或通用安装包分发。

以下内容不应提交或公开：

- `profiles.json`、`credentials.key`、私人 `access.json` 和环境秘密。
- 真实密码、私钥、Cookie、SynoToken、应用 bearer 及连接票据。
- 带服务器信息、个人路径或认证材料的日志、截图和终端输出。
- 私人定制 SPK、私人排除词文件、旧 Git 元数据和恢复备份。

`.gitignore` 用于防止误提交，不能移除已经存在于历史或云端附件中的内容。加密后的运行配置同样属于私人数据。

## 本地定制配置

将部署配置保存在仓库外，或受忽略规则保护的 `.local/` 中。构建时通过 `DSM_TERMINAL_ACCESS_CONFIG_SOURCE` 指定配置文件，并同时设置 `DSM_TERMINAL_VARIANT=private`：

```bash
DSM_TERMINAL_ACCESS_CONFIG_SOURCE=/path/to/private/access.json \
DSM_TERMINAL_VARIANT=private pnpm package:spk
```

配置仅注入临时打包目录，不修改源码默认值。生成的私人包不得上传为通用附件。构建脚本不会依据配置内容自动决定包名，因此私人构建必须明确设置变体。

外部地址的格式及部署操作见 [外部访问配置](EXTERNAL_ACCESS.md)。

## 私人排除词

可以在不提交的规则文件中指定需要排除的字符串：

```json
{
  "forbidden": ["需要排除的字符串"]
}
```

源码检查默认读取 `.local/privacy.json`。也可以通过 `DSM_TERMINAL_PRIVACY_RULES` 指定仓库外文件，显式配置优先；文件缺失或无效时检查失败。

```bash
DSM_TERMINAL_PRIVACY_RULES=/path/to/private/privacy.json \
pnpm check:publication --staged --history

DSM_TERMINAL_PRIVACY_RULES=/path/to/private/privacy.json \
pnpm check:release
```

包检查只加载显式设置的 `DSM_TERMINAL_PRIVACY_RULES`，不会自动读取 `.local/privacy.json`。不要将私人排除词硬编码到源码或上传至 Actions 日志。

## 检查范围

`pnpm check:publication` 检查文件名、跟踪文件及未被忽略的候选文件；`--staged` 改为检查暂存区内容，`--history` 增加本地分支、标签和远端跟踪引用可达历史中的文件、提交作者及提交正文。`--history --ref <提交>` 可用于检查指定提交的可达历史。

`pnpm check:release` 检查规范包名、SHA256、INFO 版本、许可、示例外部来源，以及解包后的文件路径和内容。SPK 排除 `ssh2` 测试密钥夹具与 pnpm 主机安装状态文件，保留运行依赖和第三方许可。

两种检查均结合常见秘密模式与可用的私人规则，不覆盖所有可能的秘密格式、个人信息或编码形式。应结合命中上下文检查产物；明确的本地示例、公开测试夹具、摘要与许可证署名不等于真实凭据。

## Git 与云端记录

可以为当前仓库设置中性项目署名和示例邮箱，不影响其他仓库的全局配置。检查提交正文、作者与提交者、附注标签，以及所有拟发布分支；不要镜像推送本地工具快照或私有备份引用。

发现真实秘密后应先撤销或轮换，再处理文件、历史、日志和附件。需要改写历史时先保留仓库外恢复副本，协调其他克隆，并使用精确的预期远端 SHA 防止覆盖并发更新。

删除文件或强制推送不会自动清除平台缓存、其他克隆和 Fork。GitHub 所有者及操作账号也不会因中性 Git 署名而隐藏。服务器残留处理参见 [GitHub 历史清理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。

源码检查之外，还应单独检查 Actions 日志、Artifacts、Release、Issue、PR 和附件。分发范围或可见性发生变化时，重新检查准备公开的内容。
