# OpenCodeGoBoard Changelog

## v1.3.3

- 修复“最紧张额度窗口”显示浮点数尾差（例如 `4.599999999999999%`）的问题；现在会规范化计算结果并按可读格式显示。
  Fixed floating-point artifacts in the tightest quota window (for example, `4.599999999999999%`); values are now normalized and displayed in a readable format.
- 明确记录从旧版 Electron OpenCodeBoard 到 Tauri + Rust OpenCodeGoBoard 的轻量化迁移，包括更小的 Windows 安装包与更低的运行时内存占用。
  Documented the lightweight migration from the legacy Electron OpenCodeBoard to Tauri + Rust OpenCodeGoBoard, including the substantially smaller Windows installer and lower runtime memory usage.

## v1.3.1

- 修复用量统计中按模型筛选后，“等效总费用”仍显示全部模型合计的问题；现在按当前筛选的模型求和。
  Fixed the equivalent-cost card in Usage Stats still showing the all-models total after selecting a model; it now follows the active model filter.
- 后端按模型返回 `equivalent_cost_usd`，总览与统计页共用同一口径。
  The backend now returns `equivalent_cost_usd` per model, shared by the dashboard and Usage Stats.

## v1.3.0

- 默认极简模式：新安装只保留核心配额、基础用量、最近记录与核心设置；功能可随时在“设置 → 功能模式”中开启。
  Minimal by default: fresh installs keep only core quota, basic usage, recent records, and core settings; features can be enabled anytime in Settings → Feature Mode.
- 四组功能开关：用量统计、用量记录、额度桌面提醒、高级同步；极简/完整预设按钮只写入组合，持久化的只有组开关。
  Four feature groups: Usage Stats, Usage Records, Quota Desktop Alerts, Advanced Sync; Minimal/Full preset buttons are actions only, and only group switches are persisted.
- 进一步精简：记录页只保留原始记录；总览移除当前建议、续航预测、额度变化解释和额度单位卡；设置移除数据管理、后端状态和检查更新（`data_tools` 功能组整组删除）。
  Further simplification: the Records page keeps only raw records; the dashboard drops recommendations, endurance forecasts, reconciliation and quota-unit cards; Settings drops data management, backend status and update checks (the data_tools group is removed).
- 用量统计新增自定义起止日期（按用户时区日界），可精确查看例如昨天一整天的 Token、请求与费用；趋势、汇总卡和模型排行都随所选区间统计。
  Usage Stats gains a custom start/end date range (local-timezone day boundaries), e.g. exactly yesterday; the trend, summary cards and model ranking all follow the selected range.
- 老用户升级保持全部功能并显示一次性切换提示；新用户首次引导可选择极简（默认）或完整。
  Existing users keep all features with a one-time prompt; new users can choose Minimal (default) or Full during onboarding.
- 被关闭的功能会隐藏路由/区块，后端跳过对应计算并拒绝专有接口；基础同步与额度快照采集不受影响，历史数据不删除。
  Disabled features hide routes/blocks, skip backend computation, and reject feature-specific endpoints; base sync and quota snapshot collection continue, and no data is deleted.
- 新增等效总费用：15 刀月额度档模型 ×4 折算到 60 刀口径，极简模式默认显示；模型额度档位可在设置中维护，默认来源 OpenCode 文档 2026-08-15。
  Added equivalent cost: $15-tier models are ×4 normalized to the $60 tier and shown by default in Minimal mode; model quota tiers are user-maintainable in Settings, seeded from OpenCode docs dated 2026-08-15.
- 用量趋势的“归一化对比”替换为“等效对比”：同时画实际费用与等效费用两条美元线（今日按小时，其余按天）。
  Replaced the confusing normalized comparison with an equivalent-cost comparison: actual cost and equivalent cost plotted as two USD lines (hourly for Today, daily otherwise).
- 修复今日趋势：只统计今天的数据，横坐标/悬浮提示显示真实小时而不再全部是 00:00。
  Fixed the Today trend to include only today's records and show the real hour labels instead of 00:00 everywhere.
- 单实例运行：重复启动会唤起已运行实例并退出新进程。
  Single instance: launching again brings the running instance to the front and exits the new process.
- 托盘关闭提示：每次启动后第一次最小化到托盘时短暂提示“点击托盘图标可重新打开，右键可退出”，同一次运行内只提示一次。
  Tray close hint: once per app run, show a brief hint when minimizing to tray; subsequent closes hide silently.

## v1.2.0 (fork)

- OpenCodeBoard branding and new mascot logo.
- Cost statistics fixed: cost unit is 1e-8 USD (was divided by 1e9, underreporting by 10x); existing data is migrated automatically on launch.
- Security hardening: local API token auth, strict CORS, DPAPI-encrypted cookies at rest, sandboxed windows, CSP, hardened login flow.
- Memory optimization: GPU acceleration disabled, renderer heap cap, tray mode destroys the window to free memory, close quits by default.
- Dashboard: total cost card added, compact stat cards with adaptive token units (K/M/B/T).
- Stats page merged with daily trends and gained model/account/time filters.
- About page: original author contact info removed, only this fork's repository link kept.

---

## v1.1.3

### 更新 / Updates

- 重构统计页，整合汇总卡片、模型排行与用量趋势。
  Reworked the Stats page with summary cards, model ranking and usage trends.
- 统一全站时间选择为今天、近 7 天、近 30 天和全部，并持久化最近选择。
  Unified time ranges to Today, 7 Days, 30 Days and All, with the latest choice persisted.
- 每日页支持日期导航、按模型查看 Token 明细及缓存 Token/缓存率。
  Added date navigation and per-model input, output, cache token and cache rate details.
- Dashboard 增加今日 Token 使用量，模型 Top 3 支持时间段切换。
  Added today's token usage to the Dashboard and period switching for the Top 3 models.
- 模型 Token 图表使用对数比例，并根据模型数量调整输入/输出柱间距。
  Added logarithmic model token charts with adaptive input/output bar spacing.
- 后端端口冲突时自动寻找可用端口，前端自动连接实际端口。
  The backend now finds an available port automatically and the frontend connects to it.

### 修复 / Fixes

- 修复时间范围或账户切换后数据未即时刷新的问题。
  Fixed data not refreshing immediately after changing the time range or account.
- 修复模型图表柱状图在极端 Token 数量级下不可见的问题。
  Fixed model bars becoming invisible across extreme token magnitudes.
- 修复时间选择器、费用/请求切换器选中态对比度不足的问题。
  Improved contrast for time range and cost/request selectors.
- 修复图表 Y 轴单位被裁切及输入/输出柱间距过大的问题。
  Fixed clipped Y-axis units and excessive input/output bar spacing.
