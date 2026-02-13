# GrayWill Discord Bot

基于 [fast-tavern](https://github.com/Lianues/fast-tavern) 提示词引擎的 Discord AI 聊天机器人，配备完整的 Web 管理面板。

支持 SillyTavern 预设/角色卡/世界书导入，多频道独立配置，流式输出，自动对话总结压缩，多模型端点管理。

---

## ✨ 功能特性

### 🤖 Discord Bot
- **多频道独立配置** — 每个频道可绑定不同的模型端点、预设、角色卡
- **灵活的触发模式** — @提及 / 关键词 / 所有消息 / `!ai` 命令 / 仅私信
- **流式输出** — 实时编辑消息，支持思考链（thinking）展示
- **元数据尾注** — 回复末尾显示耗时、输入/输出 Token、迭代次数
- **多模态支持** — 自动识别图片附件、自定义表情、嵌入图片，转为 base64 发送给模型
- **文本附件读取** — 自动提取 `.txt` / `.json` 附件内容作为上下文
- **引用消息解析** — 回复引用、转发消息的文本和图片都会被纳入上下文
- **斜杠命令** — `/session`、`/clear`、`/summarize`、`/status`、`/undo`、`/retry`、`/trigger`、`/model`、`/preset`

### 📝 提示词系统
- **SillyTavern 预设兼容** — 直接导入酒馆预设 JSON，完整支持 prompts 排序、正则脚本、世界书
- **角色卡管理** — 支持 V1/V2 格式角色卡导入
- **世界书** — 频道内联世界书条目，关键词触发激活
- **正则脚本** — `aiOutput` 目标正则，流式输出时实时应用
- **丰富的宏变量** — `{{char}}`、`{{user}}`、`{{currentTime}}`、`{{idle_duration}}`、`{{isOwner}}`、`{{participants}}` 等
- **可视化拖拽排序** — Web 端拖拽调整提示词顺序

### 💬 群聊历史系统
- **合并式聊天日志** — 多人消息合并为带时间线的聊天日志，而非逐条 user/assistant 交替
- **时间标记系统** — 月份分隔、日期分隔、24h 时间戳、长沉默提示
- **自动总结压缩** — Token 超阈值时自动调用 LLM 总结旧消息，释放上下文窗口
- **多会话管理** — 每个频道支持多个独立会话，随时切换

### 🌐 Web 管理面板
- **仪表盘** — Bot 在线状态、活跃频道数、今日消息数、Token 吞吐量、事件时间线
- **频道管理** — 绑定预设/角色卡/模型、触发模式、历史参数、自定义宏
- **预设编辑器** — 提示词列表拖拽排序、实时编辑、Token 计数
- **模型端点管理** — 多端点配置、模型发现、Reasoning 参数
- **总结管理** — 全局总结配置、手动触发、重总结、编辑/删除
- **调试面板** — Prompt 各阶段预览、完整消息查看
- **变量中心** — 全局/频道变量管理
- **宏变量总览** — 查看所有可用宏及其当前值

---

## 📋 环境要求

- **Node.js** 18+（推荐 20+）
- **npm** 8+
- **Discord Bot Token**（[Discord Developer Portal](https://discord.com/developers/applications) 创建）

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/your-username/graywill-discord-bot.git
cd graywill-discord-bot
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 Discord Bot Token 和其他配置：

```env
# Discord Bot
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
DISCORD_AUTO_INTENTS=Guilds,GuildMessages,MessageContent
BOT_ADMIN_IDS=your_discord_user_id_here
OWNER_DISCORD_ID=your_discord_user_id_here

# 默认 LLM 端点（可选，也可在 Web 面板中配置）
DEFAULT_LLM_BASE_URL=
DEFAULT_LLM_API_KEY=
DEFAULT_LLM_MODEL=

# Server
PORT=3000
HOST=0.0.0.0
```

### 3. 安装依赖

```bash
npm install
cd web && npm install && cd ..
```

### 4. 启动

**一键启动（Windows）：**

```bash
start-all.cmd
```

**手动启动（前后端同时）：**

```bash
npm run dev:all
```

**分别启动：**

```bash
# 后端（端口 3000）
npm run dev

# 前端（端口 5714）
npm run dev:web
```

启动后访问 `http://localhost:5714` 打开 Web 管理面板。

---

## 🏗️ 项目结构

```
graywill-discord-bot/
├── .env.example          # 环境变量模板
├── package.json          # 后端依赖
├── tsconfig.json         # TypeScript 配置
├── start-all.cmd         # Windows 一键启动脚本
│
├── src/                  # 后端源码 (TypeScript + Fastify + discord.js)
│   ├── index.ts          # 入口：Bot + Web 服务器 + API 路由
│   ├── db.ts             # SQLite 数据库（better-sqlite3）
│   ├── llm.ts            # LLM 客户端（OpenAI 兼容 API，流式/非流式）
│   ├── prompt.ts         # 提示词构建（fast-tavern 集成）
│   └── history.ts        # 群聊历史格式化（合并式时间线）
│
├── web/                  # 前端源码 (Vue 3 + Vite + TailwindCSS 4)
│   ├── src/
│   │   ├── views/        # 页面组件
│   │   ├── components/   # 通用组件
│   │   ├── composables/  # 组合式函数
│   │   ├── router/       # 路由配置
│   │   └── styles/       # 样式
│   └── vite.config.ts
│
└── data/                 # 运行时数据（已 gitignore）
    └── bot.db            # SQLite 数据库
```

---

## 📖 Discord 斜杠命令

| 命令 | 说明 |
|------|------|
| `/session new <name>` | 创建新会话并切换 |
| `/session switch <name>` | 切换到已有会话 |
| `/session list` | 列出当前频道所有会话 |
| `/session current` | 查看当前活跃会话 |
| `/clear` | 清空当前会话的聊天历史 |
| `/summarize` | 立即触发对话总结（无视阈值） |
| `/status` | 查看当前频道的配置和状态 |
| `/undo` | 撤销最后一条 Bot 回复 |
| `/retry` | 删除最后一条回复并重新生成 |
| `/trigger <mode>` | 切换触发模式 |
| `/model list` | 列出可用模型端点 |
| `/model set <value>` | 切换模型端点 |
| `/preset list` | 列出可用预设 |
| `/preset set <value>` | 切换预设 |

> 💡 斜杠命令仅限 `BOT_ADMIN_IDS` 中配置的管理员使用。

---

## 🔧 Web 管理面板页面

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 仪表盘 | Bot 状态、吞吐、Token 与运行态总览 |
| `/discord-verify` | Discord 验证 | Token / Intents / 权限 / 连通性检查 |
| `/channels` | 频道管理 | 绑定模型/预设/角色卡与触发策略 |
| `/models` | 模型端点 | OpenAI 兼容 URL、API Key、参数管理 |
| `/presets` | 预设管理 | 导入酒馆预设、编辑提示词、拖拽排序 |
| `/characters` | 角色卡 | 角色信息、开场白、角色世界书 |
| `/regex` | 正则脚本 | 正则处理链调优 |
| `/history` | 聊天历史 | 合并式时间线日志、编辑、删除 |
| `/summaries` | 总结管理 | 全局总结配置、手动触发、编辑 |
| `/variables` | 变量中心 | 全局/频道变量管理 |
| `/macros` | 宏变量总览 | 查看所有可用宏及其当前值 |
| `/debug` | 调试面板 | Prompt 各阶段预览 |

---

## 📡 API 概览

后端提供 RESTful API，前端通过 Vite 代理访问：

```
GET    /api/status                     # 系统状态
GET    /api/dashboard                  # 仪表盘数据

POST   /api/discord/verify             # 验证 Bot Token
POST   /api/discord/start              # 启动 Discord Runtime
POST   /api/discord/stop               # 停止 Discord Runtime

GET    /api/channels                   # 频道列表
PUT    /api/channels/:id               # 更新频道配置
POST   /api/channels/batch-apply       # 批量应用配置

GET    /api/endpoints                  # 模型端点列表
POST   /api/endpoints                  # 创建/更新端点
POST   /api/llm/discover-models        # 发现可用模型

GET    /api/presets                    # 预设列表
POST   /api/presets                    # 创建/更新预设

GET    /api/characters                 # 角色卡列表
POST   /api/characters                 # 创建/更新角色卡

GET    /api/history/:channelId         # 频道历史消息
POST   /api/history/:channelId/resync  # 从 Discord 重建历史

GET    /api/summaries/:channelId       # 频道总结列表
POST   /api/summaries/:channelId/trigger  # 手动触发总结

GET    /api/variables/global           # 全局变量
GET    /api/variables/channel/:id      # 频道变量

POST   /api/prompt/build              # 构建提示词（调试用）
```

---

## 🧩 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 20+ (ESM) |
| 语言 | TypeScript 5.x |
| Discord | discord.js v14 |
| Web 后端 | Fastify 5 + @fastify/cors + @fastify/websocket |
| Web 前端 | Vue 3 + Vite 6 + TailwindCSS 4 + Vue Router |
| 数据库 | SQLite (better-sqlite3) — WAL 模式 |
| 提示词引擎 | [fast-tavern](https://github.com/Lianues/fast-tavern) |
| 验证 | Zod |

---

## 📝 群聊历史格式

GrayWill 的核心设计之一是**合并式聊天日志**：群聊消息不按传统的 `user/assistant` 交替排列，而是合并为带时间线的聊天记录，作为单条 `role:user` 消息提供给 LLM。

```
======== 2026年2月 ========

──── 2026-02-10 (周一) ────

[14:32] Alice: 你好啊大家
[14:33] Bob: 嗨！最近怎么样
[14:35] Alice: 还不错，今天天气真好
[15:00] 灰魂: 是啊，阳光明媚的日子最适合出门了~

··· 沉默了 3 小时 ···

[18:22] Charlie: 有人想打游戏吗
[18:25] Alice: 来！
[18:30] 灰魂: 听起来很有趣，玩什么呢？
```

时间标记规则：

| 标记 | 格式 | 触发条件 |
|------|------|---------|
| 月份分隔 | `======== 2026年2月 ========` | 跨月时插入 |
| 日期分隔 | `──── 2026-02-10 (周一) ────` | 跨天时插入 |
| 消息时间 | `[HH:MM]` | 每条消息前缀 |
| 沉默提示 | `··· 沉默了 3 小时 ···` | 消息间隔超阈值（默认 180 分钟） |

---

## 🔒 安全说明

- `.env` 文件包含敏感凭证，**已被 `.gitignore` 排除**，永远不会被提交
- `data/` 目录包含 SQLite 数据库（含 API Key 明文），**已被 `.gitignore` 排除**
- Web 面板默认监听 `localhost`，请勿在公网直接暴露
- 建议通过反向代理（Nginx）+ 认证中间件保护 Web 面板

---

## 🙏 致谢

- **[fast-tavern](https://github.com/Lianues/fast-tavern)** — 由 [Lianues](https://github.com/Lianues) 开发的提示词构建引擎（MIT License）。本项目的预设/角色卡/世界书/正则脚本/宏变量等核心提示词处理能力均由 fast-tavern 驱动，感谢这个优秀的开源项目！
- **[discord.js](https://discord.js.org/)** — 功能强大的 Discord API 库
- **[SillyTavern](https://github.com/SillyTavern/SillyTavern)** — 预设/角色卡格式的事实标准，本项目兼容其导出格式

---

## 📄 License

MIT