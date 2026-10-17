# 1.3.4 Windows 安装包验收

日期：2026-10-17。PR #4 已合并；应用版本统一为 1.3.4，Rust Tauri 2.12.4 与前端 API 对齐，Rustls 更新为 0.23.45。Tauri 重新生成的权限 Schema 随版本提交，未扩大应用 capabilities 授权。

## 候选安装包

- 文件：`OpenCodeGoBoard_1.3.4_x64-setup.exe`，3,209,155 字节。
- SHA256：`b5e4160f316e37962554637adebb2cdece178934f95546d7ecacfe4bd4599061`。
- GitHub Release 使用本次验收的相同字节安装包，附有 `SHA256SUMS.txt`。
- Authenticode 状态为 `NotSigned`；没有生成 Tauri 更新签名或 `latest.json`。

## 已通过

- 更新后的前端 9 项、Rust 18 项；1 项手动性能 benchmark 忽略。
- TypeScript、Vite build、实际 Tauri debug 构建和 Release/NSIS 打包；安装包校验和生成与复核。
- 独立 Windows Sandbox 中全新安装：文件及卸载登记均为 1.3.4，实际窗口显示极简总览；SQLite 为 0 账户、0 用量，完整性检查通过。
- 官方 1.3.3 安装后由原生程序初始化数据库，再注入禁用的合成账户和 6 条合成用量；实际运行 1.3.4 安装器覆盖升级，版本登记更新为 1.3.4。
- 升级后 6 条记录的 ID、模型、输入/输出 token 和费用与升级前 SQLite 快照逐项相同；设置、自动同步关闭状态和数据库完整性均保留。
- 实际安装程序的统计页、记录页和设置页显示正常；截图确认 6 条记录及对应品牌图标和未知模型回退。
- 通过安装后界面的时区下拉框将 Asia/Shanghai 改为 UTC，读取 SQLite 确认保存；结束并重启实际程序后，UTC 和 6 条用量记录仍保留。
- 升级后的卸载及全新安装后的卸载均移除程序文件和卸载登记，保留用户数据库。检查等待卸载子进程完成，未仅凭安装器父进程退出判成功。

## 环境与边界

沙盒使用独立 WDAGUtilityAccount 和隔离桌面，未安装到宿主机账户，未读取真实账户、cookie 或业务数据库。沙盒网络关闭；合成账户禁用，未访问供应商或真实额度接口。

沙盒镜像中的 WebView2 默认登记与实际文件不一致，默认发现失败；测试通过 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指定沙盒现有 Microsoft WebView2 155.0.4283.60。没有为测试改动安装包或已安装程序的字节。没有验证缺少 WebView2 时安装器的联网下载引导流程，也未验证真实账户登录/同步、签名更新、macOS 或 Linux。

GitHub 仍可能显示 glib 0.18.5 的 Linux 条件性公告；Windows x64 依赖树不包含 glib，不将本轮验收表述为所有平台安全公告清零。Rustls 公告已更新到修复版本。

## 发布门禁

维护者于 2026-10-17 明确授权沿用 1.3.3 的未签名手动下载方式发布 1.3.4，[发布文档](RELEASE.md) 已同步这一决定。仓库没有配置 Tauri 更新签名或 Windows Authenticode 证书，本次不生成 latest.json，不启用应用内自动更新。版本 tag 不自动运行签名构建工作流，避免已验收安装包被重新构建覆盖。正式公开状态以 GitHub Release 为准。

原始截图、旧版 SQLite 快照、安装/升级/卸载 JSON 和校验日志保存在本次本地维护记录与 `.tmp/opencode-release-1.3.4/`，草稿 Release 的安装包哈希可独立复核。历史失败尝试单独保留，不用其结果替代上述最终验收。
