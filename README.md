# OpenCodeGoBoard

**English** · [简体中文](README_zh.md)

OpenCodeGoBoard is a local-first quota and usage decision tool for OpenCode Go. It combines official quota windows with locally synchronized usage to explain which limit is the bottleneck, whether quota can last until reset, which account or model is safer to use, and whether local history is complete.

## Highlights

- Multi-account quota, bottleneck windows, endurance forecasts, and safe budgets
- Usage sync, session/project attribution, token/cost/cache analytics
- Official-versus-local reconciliation and automatic model-weight calibration
- Optional threshold notifications, redacted diagnostics, CSV export, and validated backup/restore
- Minimal by default; enable stats, records, quota intelligence, data tools, and advanced sync in **Settings → Feature Mode**
- English and Chinese interfaces with IANA time-zone analytics and daylight-saving support
- Tauri + Rust + SQLite, with no Electron, Hono, Bun backend, or localhost HTTP service
- Auth Cookies stored in the Windows credential vault rather than the application database

## Quick start

1. Fresh installs start in **Minimal mode**. Open **Settings → Feature Mode** first if you want more pages and advanced features, or choose the Full preset.
2. Open **Settings → OpenCode Accounts → Add Account**.
3. Sign in through the system browser, copy the `auth` cookie from `https://opencode.ai`, and paste it into **Auth Cookie**.
4. Select **Test** to verify the account, then **Sync** to fetch recent usage.
5. Enable **Advanced Sync** before using **Backfill** when you need older records. Choose recent days, an end date, or all history before starting it.
6. If a cookie expires, select **Edit** or **Reauthorize**. Updating an existing account preserves its usage history.

## Application guide

### 1. Dashboard

The Dashboard is the daily decision view. It shows account availability, the earliest quota bottleneck, current quota windows, reset times, recent token usage, data health, reconciliation events, and account/model recommendations.

Use **Sync Now** when you need fresh data immediately. In Minimal mode it performs incremental sync only; with Advanced Sync enabled it also backfills 90 days of history. Forecasts need multiple quota snapshots; “insufficient data” is expected for a newly added account.

### 2. Token Analytics

(Enable the **Usage Stats** group in Feature Mode first.)

Token Analytics compares input, output, reasoning, cache reads, cost, request count, models, daily trends, and hourly distribution. Use the period and account selectors to narrow the analysis. Day boundaries and hourly buckets follow the time zone selected in Settings.

### 3. Usage Records

(Enable the **Usage Records** group in Feature Mode first.)

Usage Records provides two views:

- **Sessions** groups requests by session and project. A session can be linked to a local project name, directory, and title.
- **Records** shows individual requests, models, token breakdowns, costs, accounts, and timestamps.

Account filters and pagination apply to both views. Project cards summarize cost, cache rate, and model composition.

### 4. Settings

Settings contains the operational controls:

- **Feature Mode:** choose the Minimal or Full preset, or toggle the five feature groups individually. Minimal mode shows only the core controls below; advanced sections appear with their matching switch.
- **Language:** choose English, Chinese, or follow the operating system.
- **Time zone:** defaults to `Asia/Shanghai`; choose any available IANA zone such as `America/New_York`. It changes Today, daily/hourly analytics, period boundaries, and displayed timestamps.
- **Appearance and readability:** select theme, density, or high contrast.
- **System behavior:** configure tray behavior. Quota notifications appear with the Quota Intelligence & Alerts group.
- **Accounts:** add, enable/disable, test, edit/reauthorize, sync, backfill, or delete an account. Deleting an account also deletes its related local history; use Edit when only the cookie changed.
- **Auto sync:** choose whether synchronization runs in the background. The interval appears with Advanced Sync.
- **History backfill:** shown with Advanced Sync; select recent N days, a cutoff date, or all history. Backfill stops at the selected target or the end of available history.
- **Data management:** shown with Data & Diagnostic Tools; export CSV, create a full SQLite backup, restore a validated backup, or download a redacted diagnostic report.
- **Backend and updates:** shown with Data & Diagnostic Tools; inspect Tauri IPC health, restart the application, and check the configured signed-update source.

## Privacy and data

Usage and quota data stay in a local SQLite database. Account credentials are stored in Windows Credential Manager. Diagnostic exports omit credentials and raw account secrets. Back up the database before deleting accounts or restoring another database.

## Development

Install Node.js, pnpm, Rust, and the Windows WebView2 development prerequisites.

```bash
pnpm install
pnpm dev
```

Validation and packaging:

```bash
pnpm test
pnpm build
pnpm a11y:check
pnpm benchmark:db
pnpm dist
```

The NSIS installer is written to `src-tauri/target/release/bundle/nsis/`. See [docs/RELEASE.md](docs/RELEASE.md) for signing, updater, checksums, and rollback; [docs/ROADMAP.md](docs/ROADMAP.md) for delivery status; and [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for measured baselines.

## Architecture

```text
src/                  React/Vite interface and typed Tauri IPC client
src-tauri/src/        Rust commands, SQLite, sync, quota logic, and system integration
scripts/              Redaction, accessibility, benchmark, and release checks
docs/                 Roadmap, constraints, performance, accessibility, and release notes
```

This is an independently developed project whose initial working baseline contains MIT-licensed code. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE) for attribution. A real-account and clean-Windows-VM acceptance pass is required before a public release.
