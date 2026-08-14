<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="OpenCodeBoard — OpenCode Go Usage Dashboard">
</p>

<p align="center">
  <a href="./README.md"><img src="./assets/readme/lang-en.svg" width="100%" alt="Switch to 中文"></a>
</p>

> Thanks to the original author of [68hub](https://github.com/evanfu0110/68hub) for the open-source contribution. This fork focuses on Windows and personal use; features and behavior may differ from upstream.

---

<p align="center">
  <img src="./assets/readme/section-preview.svg" width="100%" alt="Screenshots">
</p>

| Page | Preview |
|------|---------|
| 📊 **Usage Dashboard** | ![Dashboard](Preview%20Photo/1.png) |
| 📈 **Token Stats** | ![Token Stats](Preview%20Photo/2.png) |
| 📋 **Usage Records** | ![Usage Records](Preview%20Photo/3.png) |
| ⚙️ **Settings** | ![Settings](Preview%20Photo/5.png) |

> Screenshots may lag behind the latest release. See the app for the current UI.

<p align="center">
  <img src="./assets/readme/section-features.svg" width="100%" alt="Features">
</p>

| Module | Description |
|--------|-------------|
| 📊 **Dashboard** | Account count, remaining quota, total and today's token consumption at a glance; quota progress bars (5h/7d/30d) on the left, top model Input/Output donut chart with period switching on the right |
| 📈 **Token Stats** | Model token consumption ranking, usage trends and per-model breakdown; filterable by account, model and time range, defaulting to the last 30 days with the selection persisted |
| 📋 **Usage Records** | Complete usage record log with pagination and account filtering |
| ⚙️ **Settings** | Multi-account management (add/test/sync/backfill/delete), auto-sync toggle and interval setting; automatically switches to an available backend port when needed |

<p align="center">
  <img src="./assets/readme/section-quickstart.svg" width="100%" alt="Quick Start">
</p>

```bash
# Install dependencies
pnpm install

# Run in dev mode (auto-starts backend + Vite + Electron)
pnpm dev

# Build installer (Windows)
pnpm dist
```

> The embedded backend starts automatically with the Electron main process (Hono + better-sqlite3), no need to start any separate service.

<p align="center">
  <img src="./assets/readme/section-accounts.svg" width="100%" alt="Multi-Account Support">
</p>

- **Quota**: Each account independently displays 5h/7d/30d progress bars
- **Charts**: All account data aggregated, filterable by account
- **Control**: Each account can be individually enabled/disabled

<p align="center">
  <img src="./assets/readme/section-tech.svg" width="100%" alt="Tech Stack">
</p>

| Frontend | Backend | Tools |
|----------|---------|-------|
| Electron 43 | Hono + better-sqlite3 | electron-builder |
| React 18 | TypeScript | Windows x64 |
| Vite 5 + Tailwind 4 | zod | |
| daisyUI 5 + Recharts | fetch (Node) | |

<p align="center">
  <img src="./assets/readme/section-structure.svg" width="100%" alt="Project Structure">
</p>

```
opencodeboard/
├── electron/
│   ├── main.ts            # Electron main process + embedded backend startup
│   ├── preload.ts         # IPC bridge
│   └── backend/           # Node backend (Hono + better-sqlite3)
│       ├── server.ts      # HTTP server lifecycle + auto-sync
│       ├── routes.ts      # All API routes
│       ├── db.ts          # SQLite CRUD
│       ├── config.ts      # Config/masking
│       ├── quota.ts       # OpenCode quota fetcher
│       ├── ollama-quota.ts # Ollama quota fetcher
│       ├── opencode-usage.ts # Usage record fetcher
│       ├── usage-sync.ts  # Incremental/backfill sync
│       ├── analytics.ts   # Dashboard aggregation
│       └── ...
├── src/                   # React frontend (api / components / pages / hooks)
├── public/                # Static assets and icons
└── scripts/               # Packaging helper scripts
```

<p align="center">
  <img src="./assets/readme/section-build.svg" width="100%" alt="Build">
</p>

```bash
pnpm dist
```

Output: `release\OpenCodeBoard-<version>-win-x64.exe`

**Releases**: official builds are published on [KDB-Wind/opencodeboard Releases](https://github.com/KDB-Wind/opencodeboard/releases).

**Platform support**: Windows x64 is the primary target. macOS and Linux builds are not maintained here; you can adapt the Windows code yourself, but **they are not guaranteed to run**.

<p align="center">
  <img src="./assets/readme/section-thanks.svg" width="100%" alt="Acknowledgments">
</p>

- [68hub](https://github.com/evanfu0110/68hub) — the upstream project this fork is based on
- [QuotaHub](https://github.com/lvmiao233/QuotaHub) — Backend architecture inspiration
- [OpenCode](https://opencode.ai) — API provider

<p align="center">
  <img src="./assets/readme/section-license.svg" width="100%" alt="License MIT">
</p>
