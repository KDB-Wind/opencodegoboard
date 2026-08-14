# OpenCodeGoBoard

OpenCodeGoBoard 是一个本地优先的 OpenCode Go 额度与用量决策工具。它不仅展示剩余额度，还会结合官方窗口快照和本地记录回答：哪个窗口最先耗尽、能否撑到重置、应选择哪个账号/模型，以及本地记录是否完整。

主要能力：

- 多账户配额、瓶颈窗口、续航预测和安全预算
- 用量同步、会话/项目归属、Token/成本/缓存分析
- 官方额度与本地记录对账、模型额度权重自动校准
- 默认关闭的阈值通知、脱敏诊断包、CSV 导出和数据库备份恢复
- Tauri + Rust + SQLite，无 Electron、Hono 或本地 HTTP 端口
- 系统凭据库保存 Cookie；可迁移旧版 SQLite 与 Windows DPAPI 凭据

## 本地开发

需要 Node.js、pnpm、Rust 和 Windows WebView2 开发环境。

```bash
pnpm install
pnpm dev
```

验证与打包：

```bash
pnpm test
pnpm build
pnpm a11y:check
pnpm benchmark:db
pnpm dist
```

NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`。签名更新、校验和和回滚步骤见 [docs/RELEASE.md](docs/RELEASE.md)，路线与完成状态见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 架构

```text
src/                  React/Vite UI 与统一 IPC API 门面
src-tauri/src/        Rust 命令、SQLite、同步、配额与系统集成
scripts/              脱敏、无障碍、基准和发布校验工具
docs/                 产品路线、性能、无障碍和发布说明
```

本项目是独立开发的新项目，但初始工作基线包含 MIT 许可代码。归属和项目状态见 [NOTICE.md](NOTICE.md)，原版权声明保留在 [LICENSE](LICENSE)。公开发布前仍应完成真实账号和干净 Windows VM 验收。

[English](README_en.md)
