<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="OpenCodeBoard — OpenCode Go 用量统计面板">
</p>

<p align="center">
  <a href="./README_en.md"><img src="./assets/readme/lang-zh.svg" width="100%" alt="切换至 English"></a>
</p>

> 感谢原项目 [68hub](https://github.com/evanfu0110/68hub) 作者的开源贡献。本分支专注于 Windows 平台与个人使用体验，功能、行为与上游可能存在差异。

---

<p align="center">
  <img src="./assets/readme/section-preview.svg" width="100%" alt="预览 Screenshots">
</p>

| 页面 | 截图 |
|------|------|
| 📊 **用量总览** | ![Dashboard](Preview%20Photo/1.png) |
| 📈 **Token 统计** | ![Token Stats](Preview%20Photo/2.png) |
| 📋 **使用记录** | ![Usage Records](Preview%20Photo/3.png) |
| ⚙️ **设置** | ![Settings](Preview%20Photo/5.png) |

> 截图可能滞后于最新版本，请以实际运行效果为准。

<p align="center">
  <img src="./assets/readme/section-features.svg" width="100%" alt="功能 Features">
</p>

| 模块 | 说明 |
|------|------|
| 📊 **用量总览** | 账户数量、剩余配额、总 Token 消耗和今日 Token 使用量一目了然；左侧 5h/7d/30d 配额进度条，右侧 Top 模型 Input/Output 环形图与时间切换 |
| 📈 **Token 统计** | 模型 Token 消耗排行、用量趋势与模型明细；支持账户、模型、时间范围筛选，默认近 30 天且选择会自动保存 |
| 📋 **使用记录** | 完整的使用记录日志，支持分页和账户筛选 |
| ⚙️ **设置** | 多账户管理（新增/测试/同步/回填/删除），自动同步开关与间隔设置；后端端口冲突时自动切换可用端口 |

<p align="center">
  <img src="./assets/readme/section-quickstart.svg" width="100%" alt="快速开始 Quick Start">
</p>

```bash
# 安装依赖
pnpm install

# 开发模式（自动启动后端 + Vite + Electron）
pnpm dev

# 构建安装包（Windows）
pnpm dist
```

> 内嵌后端（Hono + better-sqlite3）随 Electron 主进程自动启动，无需单独运行其他服务。

<p align="center">
  <img src="./assets/readme/section-accounts.svg" width="100%" alt="多账户支持 Multi-Account Support">
</p>

- **配额**：每个账户独立显示 5h/7d/30d 进度条
- **图表**：所有账户数据汇总展示，可按账户筛选
- **控制**：每个账户可独立启用/禁用

<p align="center">
  <img src="./assets/readme/section-tech.svg" width="100%" alt="技术栈 Tech Stack">
</p>

| 前端 | 后端 | 工具 |
|------|------|------|
| Electron 43 | Hono + better-sqlite3 | electron-builder |
| React 18 | TypeScript | Windows x64 |
| Vite 5 + Tailwind 4 | zod | |
| daisyUI 5 + Recharts | fetch (Node) | |

<p align="center">
  <img src="./assets/readme/section-structure.svg" width="100%" alt="项目结构 Project Structure">
</p>

```
opencodeboard/
├── electron/
│   ├── main.ts            # Electron 主进程 + 内嵌后端启动
│   ├── preload.ts         # IPC 桥接
│   └── backend/           # Node 后端（Hono + better-sqlite3）
│       ├── server.ts      # HTTP 服务生命周期 + 自动同步
│       ├── routes.ts      # 全部 API 路由
│       ├── db.ts          # SQLite CRUD
│       ├── config.ts      # 配置/脱敏
│       ├── quota.ts       # OpenCode 配额获取
│       ├── ollama-quota.ts # Ollama 配额获取
│       ├── opencode-usage.ts # 用量记录获取
│       ├── usage-sync.ts  # 增量/回填同步
│       ├── analytics.ts   # 总览聚合
│       └── ...
├── src/                   # React 前端（api / components / pages / hooks）
├── public/                # 静态资源与图标
└── scripts/               # 打包辅助脚本
```

<p align="center">
  <img src="./assets/readme/section-build.svg" width="100%" alt="构建 Build">
</p>

```bash
pnpm dist
```

输出：`release\OpenCodeBoard-<version>-win-x64.exe`

**发版说明**：正式版本发布在 [KDB-Wind/opencodeboard Releases](https://github.com/KDB-Wind/opencodeboard/releases)。

**平台支持**：当前优先维护 Windows x64 版本。macOS 与 Linux 可参考 Windows 版本的代码自行构建修改，但**不保证能顺利运行**。

<p align="center">
  <img src="./assets/readme/section-thanks.svg" width="100%" alt="致谢 Acknowledgments">
</p>

- [68hub](https://github.com/evanfu0110/68hub) — 本项目的前身，感谢原作者
- [QuotaHub](https://github.com/lvmiao233/QuotaHub) — 后端架构灵感
- [OpenCode](https://opencode.ai) — API 提供商

<p align="center">
  <img src="./assets/readme/section-license.svg" width="100%" alt="License MIT">
</p>
