# OpenCodeBoard Changelog

## v1.3.0

- 默认极简模式：新安装只保留核心配额、基础用量、最近记录与核心设置；功能可随时在“设置 → 功能模式”中开启。
  Minimal by default: fresh installs keep only core quota, basic usage, recent records, and core settings; features can be enabled anytime in Settings → Feature Mode.
- 五组功能开关：用量统计、用量记录、额度智能与提醒、数据与诊断工具、高级同步；极简/完整预设按钮只写入组合，持久化的只有组开关。
  Five feature groups: Usage Stats, Usage Records, Quota Intelligence & Alerts, Data & Diagnostic Tools, Advanced Sync; Minimal/Full preset buttons are actions only, and only group switches are persisted.
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
