# 依赖维护与 Windows 验证 / 2026-10-16

## 范围

用户授权推送此前本地完成的 OpenCodeGoBoard 修复，目标仓库为仍未归档的 `KDB-Wind/opencodegoboard`，默认分支 `master`。基线为 `7956273eeea4b148ce7b2fe9c82afaa55afacbc5`，交付到 `codex/local-fixes-20261016` 及草稿 PR。旧 Electron 仓库 `opencodeboard` 已归档，不在本次交付范围。

以上为最初推送阶段的授权范围。2026-10-17 用户追加授权按顺序合并、更新版本、准备草稿 Release、验收 Windows 安装包并正式发布。PR #4 已合并，随后版本更新为 1.3.4；是否已发布以 GitHub Release 状态为准。仍不读取真实账户或凭据。

## 修复

- A13 / P2：升级 Vite、Vitest、React Router 等直接与传递依赖，重建 pnpm 锁文件；在 workspace 配置中限定 KaTeX 安全版本。原锁文件审计报告的安全公告已消除，保留当前平台的类型、测试与构建检查。
- 图标库升级的聚合入口引入不兼容 UI 导出，改为直接引用所需品牌的 SVG 组件，保留品牌匹配和未知模型回退图标。补充 SSR 渲染回归，并让 Vitest 实际发现 TSX 测试。
- 仓库原来只有 tag/手动发版流程。新增 Windows PR CI，使用与发布相同的 Node 22、pnpm 10，执行冻结安装、依赖审计、前端/Rust 测试和类型/构建检查；不接入签名凭据或发布步骤。

## 本地验证证据

修复阶段已通过：前端 9 项；TypeScript 检查与 Vite build；Rust 18 项、1 项 benchmark 忽略；pnpm 审计 0 项告警。交付时在独立空目录使用 pnpm 10.34.7 完成冻结安装，再复制当前前端源码与构建配置，9 项测试、TypeScript 检查和 Vite build 均通过，重新审计仍为 0 项告警。这验证了现有锁文件和 workspace 配置与 pnpm 10 的兼容性；本机 Node 为 24.14.0，Node 22 由远端 CI 验证。最终远端 CI 必须对应 PR 的实际 head，不用历史结果替代。

Windows 原生功能复测 6 项通过，使用真实 Tauri/WebView2 与隔离 SQLite 数据：

1. 原生启动及 Rust IPC 健康检查。
2. 总览从 SQLite 读取 6 种合成模型用量并显示 SVG 图标，含未知模型回退。
3. Token 页的路由、图表和表格。
4. 6 条合成用量记录。
5. 设置页保存时区到 SQLite。
6. 结束并重启原生进程后设置恢复。

测试副本只改应用标识、数据根、凭据服务名与本机调试参数，并关闭旧库导入；业务逻辑与前端字节和修复版一致，原始哈希、截图及日志保存在本地维护记录。仅有禁用的合成账户，自动同步关闭；未接触真实 cookie、账户、业务数据库或供应商接口。

## 验收边界

本轮未验收签名安装包的安装、覆盖升级和卸载，也未进行真实账户登录/额度同步。macOS/Linux 原生挂载本轮按用户要求暂缓。推送 PR 不表示 master 已合并、安装包已发布或线上已更新。

## 1.3.4 发行准备 / 2026-10-17

PR #4 已合并为 `2facab1e6f95059395abbedd099b184b28c0282e`。首次实际打包发现 Rust Tauri 2.11.5 与前端 API 2.12.4 的次版本不匹配，普通前端 build/cargo check 未覆盖该门禁。将 Rust Tauri 更新并锁定到 2.12.4，同步应用版本到 1.3.4，并在 Windows CI 增加 `tauri build --ci --debug --no-bundle`，实际检查 Tauri 版本匹配与原生构建。

更新后的前端 9 项、Rust 18 项（1 项 benchmark 忽略）、类型检查和真实 Tauri debug 构建通过。Release 程序编译通过，NSIS 安装器在本地生成；官方 NSIS 工具下载中断后按原来源重试并核对工具哈希，没有跳过工具链校验。Windows 安装/升级/卸载正在独立 Windows Sandbox 中验收，最终结果另存发行记录；原来的 6 项功能结果不替代本次更新后的安装包验收。

仓库目前没有 Actions Secrets 或 Variables，尚未接入 Tauri 更新签名私钥/公钥及 Windows Authenticode 签名。候选包用于隔离验收，草稿 Release 不等于正式公开发布；在补齐签名和实际安装包验收前，不更新公开下载或 `latest.json`。
