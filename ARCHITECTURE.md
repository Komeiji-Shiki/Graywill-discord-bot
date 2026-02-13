# Discord LLM Bot + Web管理面板 —— 架构设计文档

> 基于 `fast-tavern` 提示词引擎，打造一个功能完备的 Discord AI 聊天机器人，配备 Web 管理界面。

---

## 一、需求分析与功能补充

### 1.1 用户原始需求

| # | 需求 | 说明 |
|---|------|------|
| 1 | Discord Bot | 监听加入的频道消息 |
| 2 | Web管理界面 | 配置管理、实时预览 |
| 3 | LLM接入 | OAI兼容API，可配置URL/Key/Model |
| 4 | fast-tavern集成 | 使用其提示词处理逻辑 |
| 5 | 酒馆预设导入 | Web端兼容导入SillyTavern的预设JSON |
| 6 | 分频道消息存储 | 监听每条消息并按频道保存 |
| 7 | Token估算+总结压缩 | 超限后调用LLM总结 |
| 8 | 向量化检索接口 | 预留embedding接口 |
| 9 | 历史记录插入位置 | 可选择历史插入到提示词的哪个位置 |
| 10 | 世界书 | WorldBook条目管理 |
| 11 | 角色卡 | CharacterCard管理 |
| 12 | 主提示词/系统提示词 | Preset prompts配置 |
| 13 | 预填充 | Assistant prefill支持 |

### 1.2 灰魂补充的功能

| # | 功能 | 理由 |
|---|------|------|
| 14 | **多频道独立配置** | 不同频道可绑定不同角色卡/预设/世界书/模型 |
| 15 | **触发模式** | 可选：@提及 / 关键词触发 / 所有消息 / 斜杠命令 / 仅私信 |
| 16 | **多模型配置** | 不同频道/场景使用不同的LLM端点和模型 |
| 17 | **群聊合并式历史** ⭐ | 多人消息合并为带时间线的聊天日志，而非逐条user/assistant交替 |
| 18 | **时间标记系统** ⭐ | 月份分隔、日期分隔、24h时间戳、长沉默提示 |
| 19 | **流式输出+思考态** ⭐ | 思考→"思考中..."，正文→逐步编辑追加 |
| 20 | **元数据尾注** ⭐ | 回复末尾追加 `-# Time | Input | Output | Iterations` |
| 21 | **工具调用接口** ⭐ | 预留tool_calls支持，带迭代计数 |
| 22 | **并发控制/消息队列** | 防止同一频道并发请求，排队处理 |
| 23 | **重试/编辑/重新生成** | 通过Discord按钮/反应重新生成回复 |
| 24 | **权限控制** | Discord角色/用户白名单/黑名单 |
| 25 | **实时日志/调试面板** | Web端实时查看提示词组装各阶段、token用量 |
| 26 | **聊天记录导出** | 导出为JSON/Markdown |
| 27 | **正则脚本管理** | 完整的CRUD + 实时预览效果 |
| 28 | **宏变量管理** | 可视化管理自定义宏和全局变量 |
| 29 | **总结记忆存储** | 总结后的记忆持久化，可编辑 |
| 30 | **消息过滤** | 可配置忽略bot消息、特定前缀消息等 |
| 31 | **预设提示词排序拖拽** | Web端可视化拖拽调整prompts顺序 |

### 1.3 需要澄清/待定的问题

| # | 问题 | 灰魂的默认决策 |
|---|------|----------------|
| Q1 | 前端框架选择 | **Vue 3 + Vite** — 轻量、生态好、适合管理面板 |
| Q2 | 数据库选择 | **SQLite (better-sqlite3)** — 零配置、单文件、够用；预留迁移到PostgreSQL的接口 |
| Q3 | 是否需要用户认证 | **简单token认证** — Web面板不对外暴露，本地/内网使用 |
| Q4 | 一个Bot实例 vs 多Bot | **单Bot实例** — 通过频道配置区分不同行为 |
| Q5 | 酒馆预设格式版本 | 支持 **SillyTavern 1.x JSON格式**（新格式，与fast-tavern对齐） |

---

## 二、技术选型

```
┌─────────────────────────────────────────────────────┐
│                    技术栈总览                         │
├─────────────┬───────────────────────────────────────┤
│ 运行时       │ Node.js 20+ (ESM)                    │
│ 语言        │ TypeScript 5.x                        │
│ Discord     │ discord.js v14                        │
│ Web后端      │ Fastify 5 + @fastify/websocket       │
│ Web前端      │ Vue 3 + Vite + Pinia + TailwindCSS   │
│ 数据库       │ SQLite (better-sqlite3) + Drizzle ORM│
│ 提示词引擎   │ fast-tavern (本地npm link)             │
│ Tokenizer   │ gpt-tokenizer (纯JS, 无native依赖)    │
│ 向量化(预留)  │ 接口抽象，可接入OpenAI/本地embedding   │
│ 进程管理     │ tsx (开发) / node (生产)               │
│ 构建        │ tsup (后端) + vite (前端)               │
└─────────────┴───────────────────────────────────────┘
```

---

## 三、项目结构

```
discord-bot/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
│
├── src/
│   ├── index.ts                    # 入口：启动Bot + Web服务器
│   │
│   ├── config/
│   │   ├── env.ts                  # 环境变量加载
│   │   └── defaults.ts             # 默认配置
│   │
│   ├── db/
│   │   ├── index.ts                # 数据库连接
│   │   ├── schema.ts               # Drizzle schema定义
│   │   └── migrations/             # 数据库迁移
│   │
│   ├── discord/
│   │   ├── client.ts               # Discord客户端初始化
│   │   ├── events/
│   │   │   ├── messageCreate.ts    # 消息监听核心
│   │   │   ├── interactionCreate.ts# 斜杠命令/按钮交互
│   │   │   └── ready.ts            # Bot就绪事件
│   │   ├── commands/
│   │   │   ├── index.ts            # 命令注册
│   │   │   ├── chat.ts             # /chat 命令
│   │   │   ├── reset.ts            # /reset 重置对话
│   │   │   └── config.ts           # /config 快捷配置
│   │   └── utils/
│   │       ├── messageFormatter.ts # Discord消息→合并式聊天日志
│   │       ├── responseHandler.ts  # 流式编辑/思考态/元数据尾注
│   │       └── permissions.ts      # 权限检查
│   │
│   ├── llm/
│   │   ├── client.ts               # OAI兼容API客户端
│   │   ├── types.ts                # LLM请求/响应类型
│   │   ├── stream.ts               # SSE流式响应解析
│   │   └── providers/
│   │       └── openai-compatible.ts# OAI兼容实现
│   │
│   ├── prompt/
│   │   ├── engine.ts               # fast-tavern封装层
│   │   ├── builder.ts              # 提示词构建入口
│   │   ├── importer.ts             # 酒馆预设/角色卡导入
│   │   └── tokenizer.ts            # Token估算
│   │
│   ├── memory/
│   │   ├── history.ts              # 频道历史记录管理
│   │   ├── summarizer.ts           # 总结压缩逻辑
│   │   └── vector.ts               # 向量化检索接口(预留)
│   │
│   ├── tools/
│   │   ├── registry.ts             # 工具注册中心
│   │   ├── types.ts                # 工具类型定义
│   │   ├── executor.ts             # 工具执行+迭代控制
│   │   └── builtins/               # 内置工具
│   │       ├── time.ts
│   │       ├── memory-search.ts
│   │       └── variables.ts
│   │
│   ├── web/
│   │   ├── server.ts               # Fastify服务器
│   │   ├── websocket.ts            # WebSocket实时通信
│   │   ├── routes/
│   │   │   ├── api.ts              # API路由总入口
│   │   │   ├── channels.ts         # 频道配置API
│   │   │   ├── presets.ts          # 预设管理API
│   │   │   ├── characters.ts       # 角色卡管理API
│   │   │   ├── worldbooks.ts       # 世界书管理API
│   │   │   ├── regex.ts            # 正则脚本API
│   │   │   ├── models.ts           # LLM模型配置API
│   │   │   ├── history.ts          # 聊天历史API
│   │   │   ├── variables.ts        # 变量管理API
│   │   │   ├── tools.ts            # 工具管理API
│   │   │   ├── import-export.ts    # 导入导出API
│   │   │   └── debug.ts            # 调试/日志API
│   │   └── middleware/
│   │       └── auth.ts             # 简单token认证
│   │
│   └── shared/
│       ├── types.ts                # 共享类型定义
│       ├── constants.ts            # 常量
│       ├── logger.ts               # 日志工具
│       └── queue.ts                # 消息队列
│
├── web/                            # Vue 3 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── router/
│   │   │   └── index.ts
│   │   ├── stores/
│   │   │   ├── app.ts              # 全局状态
│   │   │   ├── channels.ts
│   │   │   ├── presets.ts
│   │   │   ├── characters.ts
│   │   │   └── worldbooks.ts
│   │   ├── views/
│   │   │   ├── Dashboard.vue       # 仪表盘：Bot状态、频道概览
│   │   │   ├── Channels.vue        # 频道管理
│   │   │   ├── ChannelConfig.vue   # 单频道详细配置
│   │   │   ├── Presets.vue         # 预设管理（导入/编辑/拖拽排序）
│   │   │   ├── Characters.vue      # 角色卡管理
│   │   │   ├── WorldBooks.vue      # 世界书管理
│   │   │   ├── RegexScripts.vue    # 正则脚本管理
│   │   │   ├── Models.vue          # LLM模型配置
│   │   │   ├── History.vue         # 聊天记录查看/导出
│   │   │   ├── Variables.vue       # 宏与变量管理
│   │   │   └── Debug.vue           # 实时日志/提示词调试
│   │   ├── components/
│   │   │   ├── PromptEditor.vue    # 提示词编辑器（Monaco/CodeMirror）
│   │   │   ├── DraggableList.vue   # 拖拽排序组件
│   │   │   ├── FileImporter.vue    # 文件导入组件
│   │   │   ├── TokenCounter.vue    # 实时token计数
│   │   │   ├── PromptPreview.vue   # 提示词预览（各阶段）
│   │   │   └── LogViewer.vue       # 实时日志查看器
│   │   └── composables/
│   │       ├── useWebSocket.ts     # WebSocket Hook
│   │       └── useApi.ts           # API调用封装
│   └── tailwind.config.js
│
├── data/                           # 运行时数据（gitignore）
│   ├── bot.db                      # SQLite数据库
│   ├── presets/                    # 预设JSON文件
│   ├── characters/                 # 角色卡文件
│   └── worldbooks/                 # 世界书文件
│
└── fast-tavern-main/               # fast-tavern引擎（已有）
```

---

## 四、数据库设计 (SQLite + Drizzle)

### 4.1 核心表

```sql
-- LLM模型/端点配置
CREATE TABLE llm_endpoints (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,          -- OAI兼容URL
  api_key     TEXT,
  model       TEXT NOT NULL,          -- 模型名
  max_tokens  INTEGER DEFAULT 4096,   -- 最大输出token
  temperature REAL DEFAULT 0.7,
  top_p       REAL DEFAULT 1.0,
  extra_params TEXT DEFAULT '{}',     -- JSON: 额外参数
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 预设
CREATE TABLE presets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        TEXT NOT NULL,           -- JSON: PresetInfo完整结构
  source      TEXT DEFAULT 'custom',   -- custom / imported
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 角色卡
CREATE TABLE characters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  data        TEXT NOT NULL,           -- JSON: CharacterCard结构
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 世界书
CREATE TABLE worldbooks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  entries     TEXT NOT NULL,           -- JSON: WorldBookEntry[]
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 正则脚本（全局级别）
CREATE TABLE regex_scripts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        TEXT NOT NULL,           -- JSON: RegexScriptData
  scope       TEXT DEFAULT 'global',   -- global / preset / character
  parent_id   TEXT,                    -- 关联的preset/character id
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 频道配置（核心！每个频道独立配置）
CREATE TABLE channel_configs (
  channel_id     TEXT PRIMARY KEY,     -- Discord channel ID
  guild_id       TEXT,                 -- Discord guild ID
  channel_name   TEXT,
  enabled        INTEGER DEFAULT 1,
  
  -- 绑定关系
  preset_id      TEXT REFERENCES presets(id),
  character_id   TEXT REFERENCES characters(id),
  endpoint_id    TEXT REFERENCES llm_endpoints(id),
  
  -- 世界书（多对多，用JSON数组存ID）
  worldbook_ids  TEXT DEFAULT '[]',
  
  -- 触发模式
  trigger_mode   TEXT DEFAULT 'mention', -- mention/keyword/all/command/dm
  trigger_keywords TEXT DEFAULT '[]',    -- JSON: 触发关键词列表
  
  -- 消息格式化（用于合并式聊天日志）
  message_format TEXT DEFAULT '[{{time}}] {{username}}: {{content}}',
  time_zone      TEXT DEFAULT 'Asia/Shanghai',
  silence_threshold INTEGER DEFAULT 180, -- 沉默提示阈值（分钟）
  
  -- 历史与压缩
  max_history_tokens  INTEGER DEFAULT 8000,
  summary_threshold   INTEGER DEFAULT 6000,  -- 超过此值触发总结
  summary_prompt      TEXT,                   -- 自定义总结提示词
  
  -- 预填充
  assistant_prefill   TEXT DEFAULT '',
  
  -- 历史记录插入位置（对应preset中的prompt identifier）
  history_insert_at   TEXT DEFAULT 'chatHistory',
  
  -- 工具调用
  tools_enabled       INTEGER DEFAULT 0,
  max_tool_iterations  INTEGER DEFAULT 5,
  
  -- 权限
  allowed_roles  TEXT DEFAULT '[]',    -- JSON: Discord角色ID白名单
  blocked_users  TEXT DEFAULT '[]',    -- JSON: 用户ID黑名单
  
  -- 宏变量
  custom_macros  TEXT DEFAULT '{}',    -- JSON: 自定义宏
  
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

-- 频道消息历史 ⭐
CREATE TABLE channel_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id    TEXT NOT NULL,
  message_id    TEXT NOT NULL UNIQUE,    -- Discord message ID
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  content       TEXT NOT NULL,
  role          TEXT NOT NULL,           -- user / model / system
  token_count   INTEGER DEFAULT 0,
  is_bot        INTEGER DEFAULT 0,
  is_summarized INTEGER DEFAULT 0,       -- 已被总结压缩的标记
  created_at    TEXT NOT NULL,            -- ⭐ 精确时间戳！从Discord消息获取，不用DEFAULT
  
  FOREIGN KEY (channel_id) REFERENCES channel_configs(channel_id)
);
CREATE INDEX idx_messages_channel ON channel_messages(channel_id, created_at);
CREATE INDEX idx_messages_unsummarized ON channel_messages(channel_id, is_summarized, created_at);

-- 总结记忆
CREATE TABLE channel_summaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL,
  summary     TEXT NOT NULL,           -- 总结内容
  token_count INTEGER DEFAULT 0,
  covers_from TEXT,                    -- 覆盖的最早消息时间
  covers_to   TEXT,                    -- 覆盖的最晚消息时间
  message_count INTEGER DEFAULT 0,    -- 被总结的消息数
  created_at  TEXT DEFAULT (datetime('now')),
  
  FOREIGN KEY (channel_id) REFERENCES channel_configs(channel_id)
);

-- 全局变量（跨频道持久化）
CREATE TABLE global_variables (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- 频道局部变量
CREATE TABLE channel_variables (
  channel_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (channel_id, key)
);
```

---

## 五、核心模块设计

### 5.1 消息处理流程（核心主线）

```
Discord消息 → 存储(始终) → 触发判断 → 消息队列 → 构建提示词 → 调用LLM → 流式输出 → 存储回复
                                              │
                                              ▼
                                   ┌──────────────────────┐
                                   │   Prompt Builder      │
                                   │                      │
                                   │  1. 加载频道配置       │
                                   │  2. 获取未总结的消息   │
                                   │  3. 获取总结记忆       │
                                   │  4. 格式化为合并式     │
                                   │     聊天日志(带时间线) │
                                   │  5. 加载预设/角色卡    │
                                   │  6. 加载世界书         │
                                   │  7. Token估算         │
                                   │  8. 触发总结(如需要)   │
                                   │  9. 调用 fast-tavern  │
                                   │     buildPrompt()     │
                                   │ 10. 附加工具定义      │
                                   │ 11. 输出最终提示词     │
                                   └──────────────────────┘
```

### 5.2 群聊消息格式设计 ⭐（核心差异）

**设计原则**：群聊不是一对一对话，而是多人在同一个时间线上的交流日志。因此不用传统的多轮 `role:user / role:assistant` 交替，而是**将整段聊天记录合并为一个 `role:user` 块**，内含时间戳、用户名、bot回复，作为"聊天日志"提供给LLM。

#### 5.2.1 消息格式示例

发送给LLM的历史记录格式如下：

```
role: user
content: |
  ======== 2026年1月 ========

  ──── 2026-01-15 (周三) ────

  [14:32] Alice: 你好啊大家
  [14:33] Bob: 嗨！最近怎么样
  [14:35] Alice: 还不错，今天天气真好
  [15:00] {{char}}: 是啊，阳光明媚的日子最适合出门了~
  [18:22] Charlie: 有人想打游戏吗
  [18:25] Alice: 来！
  [18:30] {{char}}: 听起来很有趣，玩什么呢？

  ──── 2026-01-16 (周四) ────

  [09:12] Alice: 早上好
  [09:15] Charlie: 早！昨晚打到3点
  [09:16] Bob: 你们太猛了
  [09:20] {{char}}: 早上好~熬夜可不好，要注意休息哦

  ======== 2026年2月 ========

  ──── 2026-02-01 (周六) ────

  [10:00] Alice: 新年快乐！
  [10:05] Bob: 🎉🎉🎉
  [10:08] {{char}}: 新年快乐！新的一年也请多多关照~

  ··· 沉默了 4 小时 ···

  [14:30] Alice: 今天想聊点什么呢
```

#### 5.2.2 时间标记规则

| 标记类型 | 格式 | 触发条件 |
|---------|------|---------|
| 月份分隔 | `======== 2026年2月 ========` | 消息跨月时插入 |
| 日期分隔 | `──── 2026-02-10 (周一) ────` | 消息跨天时插入（含每天0点） |
| 消息时间 | `[HH:MM]` | 每条消息前缀，24小时制 |
| 长时间间隔提示 | `··· 沉默了 3 小时 ···` | 两条消息间隔超过配置阈值时（默认180分钟） |

#### 5.2.3 格式化实现

```typescript
interface FormattedHistory {
  /** 合并后的聊天日志文本 */
  chatLog: string;
  /** 日志的token估算 */
  tokenCount: number;
}

function formatChannelHistory(
  messages: DbMessage[],
  config: {
    botId: string;
    charName: string;
    timeZone: string;          // 如 'Asia/Shanghai'
    silenceThreshold?: number; // 沉默提示阈值（分钟），默认180
  }
): FormattedHistory {
  const lines: string[] = [];
  let lastDate: string | null = null;
  let lastMonth: string | null = null;
  let lastTime: number | null = null;

  for (const msg of messages) {
    const dt = new Date(msg.created_at);
    const dateStr = formatDate(dt, config.timeZone);    // "2026-02-10"
    const monthStr = formatMonth(dt, config.timeZone);  // "2026年2月"
    const timeStr = formatTime(dt, config.timeZone);    // "14:32"
    const weekday = formatWeekday(dt, config.timeZone); // "周一"
    
    // 月份切换标记
    if (monthStr !== lastMonth) {
      if (lastMonth !== null) lines.push('');
      lines.push(`======== ${monthStr} ========`);
      lines.push('');
      lastMonth = monthStr;
      lastDate = null; // 强制重新输出日期
    }
    
    // 日期切换标记
    if (dateStr !== lastDate) {
      lines.push(`──── ${dateStr} (${weekday}) ────`);
      lines.push('');
      lastDate = dateStr;
    }
    
    // 长时间沉默提示
    if (lastTime !== null) {
      const gap = (dt.getTime() - lastTime) / 60000; // 分钟
      const threshold = config.silenceThreshold ?? 180;
      if (gap >= threshold) {
        const hours = Math.floor(gap / 60);
        const mins = Math.round(gap % 60);
        const gapStr = hours > 0 
          ? (mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`)
          : `${mins} 分钟`;
        lines.push(`··· 沉默了 ${gapStr} ···`);
      }
    }
    lastTime = dt.getTime();
    
    // 消息行
    const displayName = msg.author_id === config.botId 
      ? config.charName   // bot消息用角色名
      : msg.author_name;  // 用户消息用Discord显示名
    
    lines.push(`[${timeStr}] ${displayName}: ${msg.content}`);
  }

  const chatLog = lines.join('\n');
  return { chatLog, tokenCount: estimateTokens(chatLog) };
}
```

#### 5.2.4 历史记录在提示词中的位置

合并后的聊天日志作为**单个 `role:user` 消息**插入到提示词中（位于 `chatHistory` 位置）。如果有总结记忆，则：

```
role: system  → 主提示词 / 角色卡 / 世界书 ...
role: user    → [总结] 之前的对话总结：...
role: user    → [聊天日志] 完整的时间线格式聊天记录
role: assistant → [预填充]（如果有）
```

### 5.3 消息监听与存储

```typescript
// 伪代码：消息监听核心逻辑
async function onMessageCreate(message: Discord.Message) {
  // 1. 基础过滤
  if (message.author.bot && message.author.id !== client.user.id) return;
  if (!isChannelEnabled(message.channelId)) return;
  
  // 2. 存储消息（无论是否触发回复，始终记录！）
  const tokenCount = estimateTokens(message.content);
  await saveMessage({
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.username,
    content: message.content,
    role: message.author.id === client.user.id ? 'model' : 'user',
    tokenCount,
    isBot: message.author.bot ? 1 : 0,
    createdAt: message.createdAt.toISOString(), // ⭐ 保留精确时间！
  });
  
  // 3. 触发判断（bot自己的消息不触发）
  if (message.author.bot) return;
  if (!shouldTrigger(message, channelConfig)) return;
  
  // 4. 权限检查
  if (!hasPermission(message, channelConfig)) return;
  
  // 5. 入队处理（防并发）
  await messageQueue.enqueue(message.channelId, async () => {
    await processAndReply(message, channelConfig);
  });
}
```

### 5.4 提示词构建（fast-tavern 集成）

```typescript
async function buildPromptForChannel(channelId: string, triggerMessage: Discord.Message) {
  const config = await getChannelConfig(channelId);
  const preset = await getPreset(config.presetId);
  const character = await getCharacter(config.characterId);
  const worldbooks = await getWorldbooks(config.worldbookIds);
  
  // 1. 获取未被总结的历史消息（按时间正序）
  const messages = await getUnsummarizedMessages(channelId);
  
  // 2. 获取总结记忆
  const summaries = await getChannelSummaries(channelId);
  
  // 3. 格式化为合并式聊天日志 ⭐
  const { chatLog, tokenCount } = formatChannelHistory(messages, {
    botId: client.user.id,
    charName: character?.name ?? 'Assistant',
    timeZone: config.timeZone ?? 'Asia/Shanghai',
    silenceThreshold: config.silenceThreshold ?? 180,
  });
  
  // 4. Token估算 — 检查是否需要总结
  if (tokenCount > config.summaryThreshold) {
    await triggerSummarization(channelId, messages, config);
    // 重新获取（总结后旧消息标记为 is_summarized=1）
    const freshMessages = await getUnsummarizedMessages(channelId);
    const freshSummaries = await getChannelSummaries(channelId);
    // ... 重新格式化
  }
  
  // 5. 构建ChatMessage[] — 合并式聊天日志作为单个user消息 ⭐
  const history: ChatMessage[] = [];
  
  // 总结记忆（如果有）
  if (summaries.length > 0) {
    const summaryText = summaries.map(s => s.summary).join('\n\n');
    history.push({ role: 'user', content: `[之前的对话总结]\n${summaryText}` });
  }
  
  // 合并式聊天日志
  history.push({ role: 'user', content: chatLog });
  
  // 6. 构建宏
  const macros = {
    user: triggerMessage.member?.displayName ?? triggerMessage.author.username,
    char: character?.name ?? 'Assistant',
    ...config.customMacros,
  };
  
  // 7. 构建变量上下文
  const localVars = await getChannelVariables(channelId);
  const globalVars = await getGlobalVariables();
  
  // 8. 处理历史插入位置
  const adjustedPreset = preparePresetForChannel(preset, config);
  
  // 9. 调用 fast-tavern
  const result = buildPrompt({
    preset: adjustedPreset,
    character,
    globals: {
      worldBooks: worldbooks,
      regexScripts: globalRegexScripts,
    },
    history,
    view: 'model',
    macros,
    variables: localVars,
    globalVariables: globalVars,
    outputFormat: 'openai',
    systemRolePolicy: 'keep',
    options: {
      positionMap: { beforeChar: 'charBefore', afterChar: 'charAfter' },
      vectorSearch: vectorSearchHook, // 预留向量检索
    },
  });
  
  // 10. 处理预填充
  if (config.assistantPrefill) {
    result.stages.output.afterPostRegex.push({
      role: 'assistant',
      content: config.assistantPrefill,
    });
  }
  
  return result;
}
```

### 5.5 Token管理与总结压缩

```
历史消息 Token 估算流程：
┌─────────────────────────────────────────────────┐
│                                                 │
│  消息池: [msg1, msg2, ..., msgN] (未总结的)      │
│  格式化后聊天日志: chatLog                        │
│  日志Token: estimateTokens(chatLog)              │
│                                                 │
│  if 日志Token > summary_threshold:              │
│    ① 计算需要总结的消息数量                       │
│       保留最近 K 条消息使得 token < threshold*0.6 │
│    ② 将需要总结的旧消息格式化为临时聊天日志        │
│       （保持时间线格式，方便LLM理解）              │
│    ③ 调用LLM生成总结                             │
│    ④ 存储总结到 channel_summaries                │
│    ⑤ 标记已总结的消息（is_summarized = 1）       │
│    ⑥ 新的历史 = [总结记忆] + [保留的最近消息日志]  │
│                                                 │
│  总结提示词（可自定义）：                          │
│  "请总结以下对话的关键信息，保留：                 │
│   - 重要的人物和关系变化                          │
│   - 关键事件和其时间                              │
│   - 设定和世界观信息                              │
│   - 数值/状态变化                                │
│   - 未完成的事项和悬念                            │
│   - 各角色的最后状态和情绪"                       │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 5.6 流式输出与Discord消息编辑 ⭐

```typescript
interface StreamReplyOptions {
  message: Discord.Message;            // 触发消息
  stream: AsyncIterable<StreamChunk>;  // LLM流式响应
  startTime: number;                   // 请求开始时间
  inputTokens: number;                 // 输入token数
}

interface StreamChunk {
  type: 'thinking' | 'content' | 'tool_call' | 'done';
  text?: string;
  toolCall?: ToolCallInfo;
  usage?: { inputTokens: number; outputTokens: number };
}

async function streamReplyToDiscord(opts: StreamReplyOptions): Promise<string> {
  const { message, stream, startTime, inputTokens } = opts;
  
  let reply: Discord.Message | null = null;
  let phase: 'thinking' | 'content' = 'thinking';
  let contentBuffer = '';
  let outputTokens = 0;
  let iterations = 0;
  let lastEditTime = 0;
  const EDIT_INTERVAL = 1200; // Discord rate limit 安全间隔(ms)
  
  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'thinking':
        // 思考阶段：显示"思考中..."
        if (!reply) {
          reply = await message.reply('💭 *思考中...*');
          lastEditTime = Date.now();
        }
        break;
        
      case 'content':
        // 正文阶段：逐步编辑追加内容
        if (phase === 'thinking') {
          phase = 'content';
        }
        contentBuffer += chunk.text ?? '';
        outputTokens += estimateTokens(chunk.text ?? '');
        
        const now = Date.now();
        if (now - lastEditTime >= EDIT_INTERVAL) {
          const display = contentBuffer + ' ▌'; // 打字光标
          if (!reply) {
            reply = await message.reply(truncateForDiscord(display));
          } else {
            await reply.edit(truncateForDiscord(display));
          }
          lastEditTime = now;
        }
        break;
        
      case 'tool_call':
        // 工具调用（预留）
        iterations++;
        if (reply) {
          await reply.edit(
            (contentBuffer || '') + 
            `\n🔧 *调用工具: ${chunk.toolCall?.name}...*`
          );
        }
        break;
        
      case 'done':
        if (chunk.usage) {
          outputTokens = chunk.usage.outputTokens;
        }
        break;
    }
  }
  
  // ⭐ 最终编辑：追加元数据尾注
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const metadata = `-# Time: ${elapsed}s | Input: ${inputTokens}t | Output: ${outputTokens}t | Iterations: ${iterations}`;
  
  const finalContent = contentBuffer 
    ? `${contentBuffer}\n${metadata}`
    : `*（无输出）*\n${metadata}`;
  
  if (reply) {
    await reply.edit(truncateForDiscord(finalContent));
  } else {
    reply = await message.reply(truncateForDiscord(finalContent));
  }
  
  return contentBuffer;
}

/** Discord消息上限2000字符，超出需分段 */
function truncateForDiscord(text: string): string {
  if (text.length <= 2000) return text;
  return text.slice(0, 1990) + '\n...(续)';
}
```

**流式输出时序图：**

```
用户发消息 ──────────────────────────────────────────────────────>

Bot响应:
  ├── [00.0s] 💭 *思考中...*                    ← 初始回复(reply)
  │
  ├── [02.5s] 这是正文的开始，我来 ▌             ← 编辑(思考结束，开始正文)
  │
  ├── [03.7s] 这是正文的开始，我来回答你的问题 ▌  ← 编辑(追加内容)
  │
  ├── [04.9s] 这是正文的开始，我来回答你的问题。  ← 编辑(继续追加)
  │           首先...blah blah ▌
  │
  ├── [06.1s] ...完整正文内容...                  ← 最终编辑(去掉光标)
  │           -# Time: 6.08s | Input: 12345t     ← 元数据尾注(subtext小字)
  │              | Output: 234t | Iterations: 0
  └──
```

**元数据尾注说明：**
- `-#` 是Discord的 **subtext** 语法，会显示为小字灰色文本
- `Time` = 总耗时（从收到消息到完成回复）
- `Input` = 输入token数（提示词总量）
- `Output` = 输出token数
- `Iterations` = 工具调用迭代次数（0 = 无工具调用）

### 5.7 工具调用接口（预留） ⭐

```typescript
/** 工具定义 */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  handler: (args: any, context: ToolContext) => Promise<ToolResult>;
}

/** 工具调用上下文 */
interface ToolContext {
  channelId: string;
  guildId: string;
  userId: string;
  message: Discord.Message;
  variables: VariableContext;
}

/** 工具调用结果 */
interface ToolResult {
  success: boolean;
  output: string;
  data?: any;
}

/** 工具注册中心 */
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }
  
  getToolSchemas(): any[] {
    return Array.from(this.tools.values()).map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }
    }));
  }
  
  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, output: `Unknown tool: ${name}` };
    return tool.handler(args, ctx);
  }
}

// 内置工具示例
const builtinTools: ToolDefinition[] = [
  {
    name: 'get_current_time',
    description: '获取当前时间',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({
      success: true,
      output: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    }),
  },
  {
    name: 'search_memory',
    description: '搜索频道历史记忆',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      // 预留：接入向量搜索
      const results = await searchChannelHistory(ctx.channelId, args.query);
      return { success: true, output: results.join('\n') };
    },
  },
  {
    name: 'set_variable',
    description: '设置一个持久化变量',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'string' },
        scope: { type: 'string', enum: ['local', 'global'] },
      },
      required: ['name', 'value'],
    },
    handler: async (args, ctx) => {
      const scope = args.scope ?? 'local';
      if (scope === 'global') {
        await setGlobalVariable(args.name, args.value);
      } else {
        await setChannelVariable(ctx.channelId, args.name, args.value);
      }
      return { success: true, output: `已设置 ${args.name} = ${args.value}` };
    },
  },
];
```

**工具调用流程（带迭代）：**

```
┌────────────────────────────────────────────────┐
│  1. 构建提示词 + tools schema                   │
│  2. 调用LLM                                    │
│  3. 如果响应包含 tool_calls:                     │
│     a. 执行工具                                 │
│     b. 将工具结果追加到消息列表                   │
│     c. iterations++                            │
│     d. 重新调用LLM（回到步骤2）                  │
│  4. 如果响应是普通文本：输出                      │
│  5. 追加元数据（含 iterations 次数）             │
│                                                │
│  安全限制：iterations 上限可配置（默认5）         │
└────────────────────────────────────────────────┘
```

### 5.8 向量化检索接口（预留）

```typescript
// 抽象接口
interface VectorStore {
  // 将文本嵌入为向量
  embed(texts: string[]): Promise<number[][]>;
  
  // 存储向量
  upsert(items: { id: string; text: string; vector: number[]; metadata?: any }[]): Promise<void>;
  
  // 相似度搜索
  search(query: string, topK?: number): Promise<{ id: string; text: string; score: number }[]>;
}

// fast-tavern 的 vectorSearch hook 接入
const vectorSearchHook = async ({ entries, contextText }) => {
  if (!vectorStore) return new Set<number>();
  
  const results = await vectorStore.search(contextText, 10);
  const hitIndexes = results
    .filter(r => r.score > 0.7)
    .map(r => parseInt(r.id));
  
  return new Set(hitIndexes);
};
```

### 5.9 酒馆预设导入兼容

```typescript
// 支持的导入格式
interface ImportCapability {
  // SillyTavern预设 JSON（包含prompts数组 + regex_scripts等）
  importSTPreset(json: any): PresetInfo;
  
  // SillyTavern角色卡 PNG/JSON（V2 spec + embedded worldbook）
  importSTCharacterCard(file: Buffer | any): CharacterCard;
  
  // SillyTavern世界书 JSON
  importSTWorldBook(json: any): WorldBook;
  
  // SillyTavern正则脚本 JSON
  importSTRegexScripts(json: any): RegexScriptData[];
}

// 导入流程：
// 1. 解析文件 → 检测格式版本
// 2. 字段映射到 fast-tavern 的类型定义
// 3. 存入数据库
// 4. Web端实时预览导入结果
```

---

## 六、Web API 设计

### 6.1 RESTful API

```
# 频道管理
GET    /api/channels                    # 列出所有已配置频道
GET    /api/channels/:id                # 获取频道详情
PUT    /api/channels/:id                # 更新频道配置
DELETE /api/channels/:id                # 删除频道配置

# 预设
GET    /api/presets                      # 列表
POST   /api/presets                      # 创建
GET    /api/presets/:id                  # 详情
PUT    /api/presets/:id                  # 更新
DELETE /api/presets/:id                  # 删除
POST   /api/presets/import              # 导入酒馆预设文件
POST   /api/presets/:id/preview         # 预览提示词组装结果

# 角色卡
GET    /api/characters
POST   /api/characters
GET    /api/characters/:id
PUT    /api/characters/:id
DELETE /api/characters/:id
POST   /api/characters/import           # 导入角色卡

# 世界书
GET    /api/worldbooks
POST   /api/worldbooks
GET    /api/worldbooks/:id
PUT    /api/worldbooks/:id
DELETE /api/worldbooks/:id
POST   /api/worldbooks/import

# 正则脚本
GET    /api/regex-scripts
POST   /api/regex-scripts
PUT    /api/regex-scripts/:id
DELETE /api/regex-scripts/:id
POST   /api/regex-scripts/test          # 测试正则效果

# LLM端点
GET    /api/endpoints
POST   /api/endpoints
PUT    /api/endpoints/:id
DELETE /api/endpoints/:id
POST   /api/endpoints/:id/test          # 测试连接

# 历史记录
GET    /api/history/:channelId          # 获取频道历史
GET    /api/history/:channelId/export   # 导出
DELETE /api/history/:channelId          # 清除历史

# 总结记忆
GET    /api/summaries/:channelId
PUT    /api/summaries/:id               # 编辑总结
DELETE /api/summaries/:id

# 变量
GET    /api/variables/global
PUT    /api/variables/global
GET    /api/variables/channel/:channelId
PUT    /api/variables/channel/:channelId

# 工具
GET    /api/tools                       # 列出已注册工具
POST   /api/tools/:name/test           # 测试工具执行

# 调试
POST   /api/debug/build-prompt          # 手动构建提示词测试
GET    /api/debug/logs                  # 获取日志

# 系统
GET    /api/status                      # Bot状态、在线频道数等
```

### 6.2 WebSocket 事件

```typescript
// 服务器 → 客户端
'bot:status'          // Bot连接状态变化
'channel:message'     // 新消息（实时显示）
'channel:reply'       // Bot回复（流式）
'channel:summary'     // 总结触发通知
'log:entry'           // 调试日志
'prompt:preview'      // 提示词构建预览

// 客户端 → 服务器  
'subscribe:channel'   // 订阅频道实时消息
'unsubscribe:channel' // 取消订阅
```

---

## 七、前端页面设计

### 7.1 页面路由

```
/                       → Dashboard（仪表盘）
/channels               → 频道列表
/channels/:id           → 频道详细配置
/presets                → 预设管理
/presets/:id            → 预设编辑器（含拖拽排序）
/characters             → 角色卡管理
/characters/:id         → 角色卡编辑
/worldbooks             → 世界书管理
/worldbooks/:id         → 世界书条目编辑
/regex                  → 正则脚本管理
/models                 → LLM端点配置
/history/:channelId     → 聊天记录查看
/variables              → 宏与变量管理
/debug                  → 实时调试面板
```

### 7.2 核心页面功能

**Dashboard**
- Bot在线状态、运行时间
- 活跃频道数、今日消息数、总Token消耗
- 最近活动时间线

**频道配置页**
- 基础：绑定预设、角色卡、LLM端点
- 触发：触发模式、关键词
- 时间：时区选择、沉默提示阈值
- 历史：最大token、总结阈值、自定义总结提示词
- 工具：启用/禁用工具调用、最大迭代次数
- 权限：角色白名单、用户黑名单
- 高级：预填充、历史插入位置、自定义宏
- 世界书：多选绑定

**预设编辑器**
- 左侧：提示词列表（可拖拽排序）
- 右侧：选中提示词的编辑面板
  - identifier、name、role、content（代码编辑器）
  - position（relative/fixed）、depth、order
  - enabled 开关
- 底部：实时预览组装后的提示词（各阶段切换）
- 顶部：导入/导出按钮

**世界书编辑器**
- 条目列表（搜索、筛选、批量操作）
- 条目编辑：key、secondaryKey、selectiveLogic、activationMode
- position、depth、order
- 测试面板：输入文本，查看哪些条目被激活

**调试面板**
- 实时日志流
- 手动输入消息测试提示词构建
- 各阶段提示词查看（raw → afterPreRegex → afterMacro → afterPostRegex）
- Token用量可视化
- 合并式聊天日志预览

---

## 八、关键实现细节

### 8.1 历史记录插入位置

用户可以在频道配置中指定 `history_insert_at`，该值对应预设中某个 prompt 的 `identifier`。

由于群聊的历史记录是**合并为单个 `role:user` 消息**的聊天日志，它会被放入 fast-tavern 的 `history` 参数中。`chatHistoryIdentifier` 决定了这条合并消息在提示词骨架中的插入位置。

```typescript
// 实现方式：
// fast-tavern 的 assembleTaggedPromptList 已支持 chatHistoryIdentifier 参数
// 在我们的封装层中，动态修改 preset.prompts 中对应 identifier

function preparePresetForChannel(preset: PresetInfo, config: ChannelConfig): PresetInfo {
  const historyId = config.historyInsertAt ?? 'chatHistory';
  
  // 确保 preset 中有对应 identifier 的 prompt
  const hasHistorySlot = preset.prompts.some(p => p.identifier === historyId);
  if (!hasHistorySlot) {
    console.warn(`历史插入位置 "${historyId}" 在预设中不存在，使用默认 "chatHistory"`);
    return preset;
  }
  
  // 如果 historyId 不是 'chatHistory'，需要交换 identifier
  if (historyId !== 'chatHistory') {
    return {
      ...preset,
      prompts: preset.prompts.map(p => {
        if (p.identifier === 'chatHistory') return { ...p, identifier: '__chatHistory_disabled__' };
        if (p.identifier === historyId) return { ...p, identifier: 'chatHistory' };
        return p;
      }),
    };
  }
  
  return preset;
}
```

### 8.2 消息队列（防并发）

```typescript
class ChannelMessageQueue {
  private queues = new Map<string, Promise<void>>();
  
  async enqueue(channelId: string, task: () => Promise<void>) {
    const current = this.queues.get(channelId) ?? Promise.resolve();
    const next = current.then(task).catch(err => {
      logger.error(`Channel ${channelId} task error:`, err);
    });
    this.queues.set(channelId, next);
    await next;
  }
}
```

### 8.3 LLM请求构建（含工具调用+流式）

```typescript
interface LLMRequestOptions {
  messages: ChatMessage[];
  endpoint: LLMEndpoint;
  tools?: ToolDefinition[];       // 工具列表（可选）
  stream?: boolean;               // 是否流式
  assistantPrefill?: string;      // 预填充
}

async function* callLLMStream(opts: LLMRequestOptions): AsyncGenerator<StreamChunk> {
  const { messages, endpoint, tools, assistantPrefill } = opts;
  
  const body: any = {
    model: endpoint.model,
    messages: messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: 'content' in m ? m.content : m.parts?.map(p => 'text' in p ? p.text : '').join(''),
    })),
    stream: true,
    max_tokens: endpoint.maxTokens,
    temperature: endpoint.temperature,
    top_p: endpoint.topP,
    ...JSON.parse(endpoint.extraParams || '{}'),
  };
  
  // 添加工具定义
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  
  // 预填充：添加一条 assistant 消息
  if (assistantPrefill) {
    body.messages.push({ role: 'assistant', content: assistantPrefill });
  }
  
  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(endpoint.apiKey ? { 'Authorization': `Bearer ${endpoint.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  
  // 解析SSE流
  for await (const chunk of parseSSEStream(response.body)) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.reasoning_content) {
      yield { type: 'thinking', text: delta.reasoning_content };
    } else if (delta?.content) {
      yield { type: 'content', text: delta.content };
    } else if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        yield { type: 'tool_call', toolCall: tc };
      }
    }
    
    // usage 通常在最后一个chunk
    if (chunk.usage) {
      yield { 
        type: 'done', 
        usage: { 
          inputTokens: chunk.usage.prompt_tokens, 
          outputTokens: chunk.usage.completion_tokens 
        } 
      };
    }
  }
}
```

---

## 九、开发计划（分阶段）

### Phase 1：核心骨架 🏗️
- [x] 架构设计（本文档）
- [ ] 项目初始化（monorepo结构、TypeScript配置）
- [ ] 数据库Schema + Drizzle配置
- [ ] Discord Bot基础（连接、消息监听、存储）
- [ ] 消息格式化（合并式聊天日志+时间标记）
- [ ] fast-tavern集成（基础buildPrompt调用）
- [ ] LLM客户端（OAI兼容API调用+流式）
- [ ] 流式输出到Discord（思考态+编辑追加+元数据尾注）
- [ ] 基础消息处理流程跑通

### Phase 2：Web后端API 🔌
- [ ] Fastify服务器 + 路由
- [ ] 预设/角色卡/世界书 CRUD API
- [ ] 频道配置API
- [ ] LLM端点管理API
- [ ] 酒馆预设导入
- [ ] WebSocket实时事件

### Phase 3：Web前端 🎨
- [ ] Vue 3 项目搭建
- [ ] Dashboard
- [ ] 频道管理页
- [ ] 预设编辑器（含拖拽排序）
- [ ] 角色卡/世界书管理页
- [ ] 正则脚本管理页

### Phase 4：高级功能 ✨
- [ ] Token估算 + 总结压缩
- [ ] 工具调用接口
- [ ] 调试面板
- [ ] 消息队列/并发控制
- [ ] 向量化检索接口

### Phase 5：打磨 💎
- [ ] 权限系统
- [ ] 导出聊天记录
- [ ] 变量管理
- [ ] 重新生成/编辑按钮
- [ ] 错误处理/重试
- [ ] 部署文档

---

## 十、技术风险与注意事项

| 风险 | 缓解策略 |
|------|----------|
| Discord API Rate Limit | 消息队列 + 编辑间隔≥1.2s + 分段发送(>2000字符) |
| Token估算精度 | 使用 gpt-tokenizer 对齐 cl100k_base，但不同模型有差异，预留10%余量 |
| SQLite并发写入 | better-sqlite3 是同步的，天然避免写入冲突；启用WAL模式 |
| 酒馆预设格式兼容 | 需处理多种格式版本（V1/V2），做字段映射和容错 |
| fast-tavern async | `buildPrompt` 的 vectorSearch 支持 Promise，主流程需改为 async |
| 大量历史消息 | 合并式日志格式天然紧凑 + 总结压缩 + 可配置保留条数 |
| 超长回复(>2000字符) | 考虑分段发送或使用embed/附件 |
| 流式编辑抖动 | 编辑间隔≥1.2s，减少视觉抖动 |

---

*文档版本: v0.2 | 作者: 灰魂 | 日期: 2026-02-10*