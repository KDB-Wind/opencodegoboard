# OpenCodeGoBoard

OpenCodeGoBoard is a local-first quota and usage decision tool for OpenCode Go. Beyond displaying remaining quota, it combines official window snapshots with local usage to show the earliest bottleneck, reset coverage, account/model recommendations, and data completeness.

Highlights:

- Multi-account quota, endurance forecasts, bottlenecks, and safe budgets
- Usage sync, session/project attribution, token/cost/cache analytics
- Official-versus-local reconciliation and automatic model-weight calibration
- Opt-in threshold notifications, redacted diagnostics, CSV export, and validated backup/restore
- Tauri + Rust + SQLite, with no Electron, Hono, or localhost HTTP server
- Cookies in the system credential vault, including migration from legacy Windows DPAPI storage

## Development

Install Node.js, pnpm, Rust, and the Windows WebView2 development prerequisites.

```bash
pnpm install
pnpm dev
```

```bash
pnpm test
pnpm build
pnpm a11y:check
pnpm benchmark:db
pnpm dist
```

The NSIS installer is written to `src-tauri/target/release/bundle/nsis/`. See [docs/RELEASE.md](docs/RELEASE.md) for signing, updater, checksums, and rollback; see [docs/ROADMAP.md](docs/ROADMAP.md) for delivery status.

This is an independently developed project whose initial working baseline contains MIT-licensed code. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE) for attribution. A real-account and clean-Windows-VM acceptance pass is still required before public release.

[中文](README.md)
