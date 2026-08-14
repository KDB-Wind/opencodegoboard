# OpenCodeBoard Changelog

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
