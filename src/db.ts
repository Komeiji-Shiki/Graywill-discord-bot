import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(process.cwd(), 'data')
const DB_PATH = join(DATA_DIR, 'bot.db')

let dbInstance: Database.Database | null = null

export type MessageRole = 'user' | 'bot' | 'system' | 'model'

export interface ChannelConfigRecord {
  channelId: string
  guildId: string | null
  channelName: string | null
  enabled: boolean
  endpointId: string | null
  presetId: string | null
  characterId: string | null
  triggerMode: 'mention' | 'keyword' | 'all' | 'command' | 'dm'
  summaryThreshold: number
  maxHistoryTokens: number
  /** 构建对话上下文时，读取最近多少条消息 */
  historyMessageLimit: number
  timeZone: string
  silenceThreshold: number
  toolsEnabled: boolean
  maxToolIterations: number
  historyInsertAt: string
  assistantPrefill: string
  worldbookInlineJson: string
  customMacrosJson: string
  activeSessionId: string
  userDisplayName: string
  /** 总结功能：system 提示词 */
  summarySystemPrompt: string
  /** 总结功能：user 提示词模板（{{chatLog}} 会被替换为聊天记录） */
  summaryUserPrompt: string
  /** 总结功能：独立端点 ID（为空时复用频道端点） */
  summaryEndpointId: string | null
  /** 总结功能：温度 */
  summaryTemperature: number
  /** 总结功能：最大输出 tokens */
  summaryMaxTokens: number
  createdAt: string
  updatedAt: string
}

export interface SummaryConfigRecord {
  summaryThreshold: number
  summarySystemPrompt: string
  summaryUserPrompt: string
  summaryEndpointId: string | null
  summaryTemperature: number
  summaryMaxTokens: number
  updatedAt: string
}

export interface ChannelMessageRecord {
  id: number
  channelId: string
  messageId: string
  authorId: string
  authorName: string
  content: string
  role: MessageRole
  tokenCount: number
  isBot: boolean
  isSummarized: boolean
  sessionId: string
  createdAt: string
}

export interface ChannelMessageInput {
  channelId: string
  messageId: string
  authorId: string
  authorName: string
  content: string
  role: MessageRole
  tokenCount?: number
  isBot?: boolean
  sessionId?: string
  createdAt?: string
}

export interface ChannelSummaryRecord {
  id: number
  channelId: string
  sessionId: string
  summary: string
  tokenCount: number
  coversFrom: string | null
  coversTo: string | null
  messageCount: number
  createdAt: string
}

export interface EndpointRecord {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
  topP: number
  extraParams: string
  /** 思考预算（0 表示不显式指定） */
  reasoningMaxTokens: number
  /** 思考努力程度：'', auto, low, medium, high */
  reasoningEffort: string
  /** 是否在流式阶段显示思维链文本 */
  showThinking: boolean
  createdAt: string
  updatedAt: string
}

export interface PresetRecord {
  id: string
  name: string
  data: string
  updatedAt: string
}

export interface CharacterRecord {
  id: string
  name: string
  data: string
  updatedAt: string
}

function nowIso() {
  return new Date().toISOString()
}

function parseBool(v: unknown): boolean {
  return Number(v) === 1
}

const SUMMARY_CONFIG_STORAGE_KEY = '__summary_config__'

const DEFAULT_SUMMARY_CONFIG: Omit<SummaryConfigRecord, 'updatedAt'> = {
  summaryThreshold: 6000,
  summarySystemPrompt: '',
  summaryUserPrompt: '',
  summaryEndpointId: null,
  summaryTemperature: 0.2,
  summaryMaxTokens: 1024,
}

function normalizeSummaryConfig(
  raw?: Partial<SummaryConfigRecord> | null
): Omit<SummaryConfigRecord, 'updatedAt'> {
  const thresholdNum = Number(raw?.summaryThreshold)
  const summaryThreshold = Number.isFinite(thresholdNum)
    ? Math.max(1, Math.floor(thresholdNum))
    : DEFAULT_SUMMARY_CONFIG.summaryThreshold

  const systemPrompt = typeof raw?.summarySystemPrompt === 'string'
    ? raw.summarySystemPrompt
    : DEFAULT_SUMMARY_CONFIG.summarySystemPrompt

  const userPrompt = typeof raw?.summaryUserPrompt === 'string'
    ? raw.summaryUserPrompt
    : DEFAULT_SUMMARY_CONFIG.summaryUserPrompt

  const endpointRaw = typeof raw?.summaryEndpointId === 'string'
    ? raw.summaryEndpointId.trim()
    : ''
  const summaryEndpointId = endpointRaw.length > 0 ? endpointRaw : null

  const temperatureNum = Number(raw?.summaryTemperature)
  const summaryTemperature = Number.isFinite(temperatureNum)
    ? temperatureNum
    : DEFAULT_SUMMARY_CONFIG.summaryTemperature

  const maxTokensNum = Number(raw?.summaryMaxTokens)
  const summaryMaxTokens = Number.isFinite(maxTokensNum)
    ? Math.max(0, Math.floor(maxTokensNum))
    : DEFAULT_SUMMARY_CONFIG.summaryMaxTokens

  return {
    summaryThreshold,
    summarySystemPrompt: systemPrompt,
    summaryUserPrompt: userPrompt,
    summaryEndpointId,
    summaryTemperature,
    summaryMaxTokens,
  }
}

function parseStoredSummaryConfig(value: string | null | undefined): Partial<SummaryConfigRecord> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Partial<SummaryConfigRecord>
    }
  } catch {
    // noop
  }
  return {}
}

function pickLegacySummaryConfig(): Partial<SummaryConfigRecord> {
  const db = openDb()
  const row = db.prepare(`
    SELECT
      summary_threshold,
      summary_system_prompt,
      summary_user_prompt,
      summary_endpoint_id,
      summary_temperature,
      summary_max_tokens
    FROM channel_configs
    ORDER BY updated_at DESC
    LIMIT 1
  `).get() as any | undefined

  if (!row) return {}

  return {
    summaryThreshold: Number(row.summary_threshold ?? DEFAULT_SUMMARY_CONFIG.summaryThreshold),
    summarySystemPrompt: String(row.summary_system_prompt ?? DEFAULT_SUMMARY_CONFIG.summarySystemPrompt),
    summaryUserPrompt: String(row.summary_user_prompt ?? DEFAULT_SUMMARY_CONFIG.summaryUserPrompt),
    summaryEndpointId: row.summary_endpoint_id ?? DEFAULT_SUMMARY_CONFIG.summaryEndpointId,
    summaryTemperature: Number(row.summary_temperature ?? DEFAULT_SUMMARY_CONFIG.summaryTemperature),
    summaryMaxTokens: Number(row.summary_max_tokens ?? DEFAULT_SUMMARY_CONFIG.summaryMaxTokens),
  }
}

function stringifySummaryConfig(config: Omit<SummaryConfigRecord, 'updatedAt'>): string {
  return JSON.stringify({
    summaryThreshold: config.summaryThreshold,
    summarySystemPrompt: config.summarySystemPrompt,
    summaryUserPrompt: config.summaryUserPrompt,
    summaryEndpointId: config.summaryEndpointId,
    summaryTemperature: config.summaryTemperature,
    summaryMaxTokens: config.summaryMaxTokens,
  })
}

export function getSummaryConfig(): SummaryConfigRecord {
  const db = openDb()
  const row = db
    .prepare('SELECT value, updated_at FROM global_variables WHERE key = ?')
    .get(SUMMARY_CONFIG_STORAGE_KEY) as any | undefined

  if (row) {
    const normalized = normalizeSummaryConfig(parseStoredSummaryConfig(row.value))
    return {
      ...normalized,
      updatedAt: String(row.updated_at ?? nowIso()),
    }
  }

  // 首次读取时：自动从旧版频道配置中挑一份作为全局默认，避免用户配置丢失
  const normalized = normalizeSummaryConfig(pickLegacySummaryConfig())
  const updatedAt = nowIso()

  db.prepare(`
    INSERT INTO global_variables (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value=excluded.value,
      updated_at=excluded.updated_at
  `).run(
    SUMMARY_CONFIG_STORAGE_KEY,
    stringifySummaryConfig(normalized),
    updatedAt
  )

  return {
    ...normalized,
    updatedAt,
  }
}

export function upsertSummaryConfig(input: Partial<SummaryConfigRecord>): SummaryConfigRecord {
  const db = openDb()
  const prev = getSummaryConfig()

  const normalized = normalizeSummaryConfig({
    summaryThreshold: input.summaryThreshold ?? prev.summaryThreshold,
    summarySystemPrompt: input.summarySystemPrompt ?? prev.summarySystemPrompt,
    summaryUserPrompt: input.summaryUserPrompt ?? prev.summaryUserPrompt,
    summaryEndpointId: input.summaryEndpointId ?? prev.summaryEndpointId,
    summaryTemperature: input.summaryTemperature ?? prev.summaryTemperature,
    summaryMaxTokens: input.summaryMaxTokens ?? prev.summaryMaxTokens,
  })

  const updatedAt = nowIso()

  db.prepare(`
    INSERT INTO global_variables (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value=excluded.value,
      updated_at=excluded.updated_at
  `).run(
    SUMMARY_CONFIG_STORAGE_KEY,
    stringifySummaryConfig(normalized),
    updatedAt
  )

  return {
    ...normalized,
    updatedAt,
  }
}

function openDb(): Database.Database {
  if (dbInstance) return dbInstance

  mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  db.exec(`
CREATE TABLE IF NOT EXISTS llm_endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  max_tokens INTEGER NOT NULL DEFAULT 2048,
  temperature REAL NOT NULL DEFAULT 0.7,
  top_p REAL NOT NULL DEFAULT 1.0,
  extra_params TEXT NOT NULL DEFAULT '{}',
  reasoning_max_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_effort TEXT NOT NULL DEFAULT '',
  show_thinking INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_configs (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT,
  channel_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  endpoint_id TEXT,
  preset_id TEXT,
  character_id TEXT,
  trigger_mode TEXT NOT NULL DEFAULT 'mention',
  summary_threshold INTEGER NOT NULL DEFAULT 6000,
  max_history_tokens INTEGER NOT NULL DEFAULT 8000,
  history_message_limit INTEGER NOT NULL DEFAULT 500,
  time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  silence_threshold INTEGER NOT NULL DEFAULT 180,
  tools_enabled INTEGER NOT NULL DEFAULT 0,
  max_tool_iterations INTEGER NOT NULL DEFAULT 5,
  history_insert_at TEXT NOT NULL DEFAULT 'chatHistory',
  assistant_prefill TEXT NOT NULL DEFAULT '',
  worldbook_inline_json TEXT NOT NULL DEFAULT '[]',
  custom_macros_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  role TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0,
  is_summarized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_time
  ON channel_messages(channel_id, created_at);

CREATE INDEX IF NOT EXISTS idx_channel_messages_unsummarized
  ON channel_messages(channel_id, is_summarized, created_at);

CREATE TABLE IF NOT EXISTS channel_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  covers_from TEXT,
  covers_to TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_summaries_channel_time
  ON channel_summaries(channel_id, created_at);

CREATE TABLE IF NOT EXISTS global_variables (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_variables (
  channel_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(channel_id, key)
);
`)

  // ─── Schema Migrations ────────────────────────────
  // session_id on channel_messages
  const msgCols = db.pragma('table_info(channel_messages)') as any[]
  if (!msgCols.some((c: any) => c.name === 'session_id')) {
    db.exec(`ALTER TABLE channel_messages ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_channel_messages_session ON channel_messages(channel_id, session_id, created_at)`)
  }

  // active_session_id on channel_configs
  const cfgCols = db.pragma('table_info(channel_configs)') as any[]
  if (!cfgCols.some((c: any) => c.name === 'active_session_id')) {
    db.exec(`ALTER TABLE channel_configs ADD COLUMN active_session_id TEXT NOT NULL DEFAULT 'default'`)
  }

  // user_display_name on channel_configs
  const cfgCols2 = db.pragma('table_info(channel_configs)') as any[]
  if (!cfgCols2.some((c: any) => c.name === 'user_display_name')) {
    db.exec(`ALTER TABLE channel_configs ADD COLUMN user_display_name TEXT NOT NULL DEFAULT ''`)
  }

  // session_id on channel_summaries
  const sumCols = db.pragma('table_info(channel_summaries)') as any[]
  if (!sumCols.some((c: any) => c.name === 'session_id')) {
    db.exec(`ALTER TABLE channel_summaries ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_channel_summaries_session ON channel_summaries(channel_id, session_id, created_at)`)
  }

  // summary config fields on channel_configs
  const cfgCols3 = db.pragma('table_info(channel_configs)') as any[]
  if (!cfgCols3.some((c: any) => c.name === 'summary_system_prompt')) {
    db.exec(`ALTER TABLE channel_configs ADD COLUMN summary_system_prompt TEXT NOT NULL DEFAULT ''`)
    db.exec(`ALTER TABLE channel_configs ADD COLUMN summary_user_prompt TEXT NOT NULL DEFAULT ''`)
    db.exec(`ALTER TABLE channel_configs ADD COLUMN summary_endpoint_id TEXT DEFAULT NULL`)
    db.exec(`ALTER TABLE channel_configs ADD COLUMN summary_temperature REAL NOT NULL DEFAULT 0.2`)
    db.exec(`ALTER TABLE channel_configs ADD COLUMN summary_max_tokens INTEGER NOT NULL DEFAULT 1024`)
  }

  // history_message_limit on channel_configs
  const cfgCols4 = db.pragma('table_info(channel_configs)') as any[]
  if (!cfgCols4.some((c: any) => c.name === 'history_message_limit')) {
    db.exec(`ALTER TABLE channel_configs ADD COLUMN history_message_limit INTEGER NOT NULL DEFAULT 500`)
  }

  // llm_endpoints reasoning fields
  const endpointCols = db.pragma('table_info(llm_endpoints)') as any[]
  if (!endpointCols.some((c: any) => c.name === 'reasoning_max_tokens')) {
    db.exec(`ALTER TABLE llm_endpoints ADD COLUMN reasoning_max_tokens INTEGER NOT NULL DEFAULT 0`)
  }
  if (!endpointCols.some((c: any) => c.name === 'reasoning_effort')) {
    db.exec(`ALTER TABLE llm_endpoints ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''`)
  }
  if (!endpointCols.some((c: any) => c.name === 'show_thinking')) {
    db.exec(`ALTER TABLE llm_endpoints ADD COLUMN show_thinking INTEGER NOT NULL DEFAULT 0`)
  }

  dbInstance = db
  return db
}

export function getDb() {
  return openDb()
}

export function listChannelConfigs(): ChannelConfigRecord[] {
  const db = openDb()
  const rows = db
    .prepare('SELECT * FROM channel_configs ORDER BY channel_id ASC')
    .all() as any[]
  return rows.map(mapChannelConfig)
}

export function getChannelConfig(channelId: string): ChannelConfigRecord | null {
  const db = openDb()
  const row = db
    .prepare('SELECT * FROM channel_configs WHERE channel_id = ?')
    .get(channelId) as any | undefined
  return row ? mapChannelConfig(row) : null
}

export function upsertChannelConfig(
  input: Partial<ChannelConfigRecord> & Pick<ChannelConfigRecord, 'channelId'>
): ChannelConfigRecord {
  const db = openDb()
  const prev = getChannelConfig(input.channelId)
  const createdAt = prev?.createdAt ?? nowIso()
  const merged: ChannelConfigRecord = {
    channelId: input.channelId,
    guildId: input.guildId ?? prev?.guildId ?? null,
    channelName: input.channelName ?? prev?.channelName ?? null,
    enabled: input.enabled ?? prev?.enabled ?? true,
    endpointId: input.endpointId ?? prev?.endpointId ?? null,
    presetId: input.presetId ?? prev?.presetId ?? null,
    characterId: input.characterId ?? prev?.characterId ?? null,
    triggerMode: input.triggerMode ?? prev?.triggerMode ?? 'mention',
    summaryThreshold: input.summaryThreshold ?? prev?.summaryThreshold ?? 6000,
    maxHistoryTokens: input.maxHistoryTokens ?? prev?.maxHistoryTokens ?? 8000,
    historyMessageLimit: input.historyMessageLimit ?? prev?.historyMessageLimit ?? 500,
    timeZone: input.timeZone ?? prev?.timeZone ?? 'Asia/Shanghai',
    silenceThreshold: input.silenceThreshold ?? prev?.silenceThreshold ?? 180,
    toolsEnabled: input.toolsEnabled ?? prev?.toolsEnabled ?? false,
    maxToolIterations: input.maxToolIterations ?? prev?.maxToolIterations ?? 5,
    historyInsertAt: input.historyInsertAt ?? prev?.historyInsertAt ?? 'chatHistory',
    assistantPrefill: input.assistantPrefill ?? prev?.assistantPrefill ?? '',
    worldbookInlineJson: input.worldbookInlineJson ?? prev?.worldbookInlineJson ?? '[]',
    customMacrosJson: input.customMacrosJson ?? prev?.customMacrosJson ?? '{}',
    activeSessionId: input.activeSessionId ?? prev?.activeSessionId ?? 'default',
    userDisplayName: input.userDisplayName ?? prev?.userDisplayName ?? '',
    summarySystemPrompt: input.summarySystemPrompt ?? prev?.summarySystemPrompt ?? '',
    summaryUserPrompt: input.summaryUserPrompt ?? prev?.summaryUserPrompt ?? '',
    summaryEndpointId: input.summaryEndpointId ?? prev?.summaryEndpointId ?? null,
    summaryTemperature: input.summaryTemperature ?? prev?.summaryTemperature ?? 0.2,
    summaryMaxTokens: input.summaryMaxTokens ?? prev?.summaryMaxTokens ?? 1024,
    createdAt,
    updatedAt: nowIso(),
  }

  db.prepare(`
    INSERT INTO channel_configs (
      channel_id, guild_id, channel_name, enabled, endpoint_id, preset_id, character_id,
      trigger_mode, summary_threshold, max_history_tokens, history_message_limit, time_zone, silence_threshold,
      tools_enabled, max_tool_iterations, history_insert_at, assistant_prefill,
      worldbook_inline_json, custom_macros_json, active_session_id, user_display_name,
      summary_system_prompt, summary_user_prompt, summary_endpoint_id,
      summary_temperature, summary_max_tokens,
      created_at, updated_at
    ) VALUES (
      @channelId, @guildId, @channelName, @enabled, @endpointId, @presetId, @characterId,
      @triggerMode, @summaryThreshold, @maxHistoryTokens, @historyMessageLimit, @timeZone, @silenceThreshold,
      @toolsEnabled, @maxToolIterations, @historyInsertAt, @assistantPrefill,
      @worldbookInlineJson, @customMacrosJson, @activeSessionId, @userDisplayName,
      @summarySystemPrompt, @summaryUserPrompt, @summaryEndpointId,
      @summaryTemperature, @summaryMaxTokens,
      @createdAt, @updatedAt
    )
    ON CONFLICT(channel_id) DO UPDATE SET
      guild_id=excluded.guild_id,
      channel_name=excluded.channel_name,
      enabled=excluded.enabled,
      endpoint_id=excluded.endpoint_id,
      preset_id=excluded.preset_id,
      character_id=excluded.character_id,
      trigger_mode=excluded.trigger_mode,
      summary_threshold=excluded.summary_threshold,
      max_history_tokens=excluded.max_history_tokens,
      history_message_limit=excluded.history_message_limit,
      time_zone=excluded.time_zone,
      silence_threshold=excluded.silence_threshold,
      tools_enabled=excluded.tools_enabled,
      max_tool_iterations=excluded.max_tool_iterations,
      history_insert_at=excluded.history_insert_at,
      assistant_prefill=excluded.assistant_prefill,
      worldbook_inline_json=excluded.worldbook_inline_json,
      custom_macros_json=excluded.custom_macros_json,
      active_session_id=excluded.active_session_id,
      user_display_name=excluded.user_display_name,
      summary_system_prompt=excluded.summary_system_prompt,
      summary_user_prompt=excluded.summary_user_prompt,
      summary_endpoint_id=excluded.summary_endpoint_id,
      summary_temperature=excluded.summary_temperature,
      summary_max_tokens=excluded.summary_max_tokens,
      updated_at=excluded.updated_at
  `).run({
    ...merged,
    enabled: merged.enabled ? 1 : 0,
    toolsEnabled: merged.toolsEnabled ? 1 : 0,
  })

  return merged
}

function mapChannelConfig(row: any): ChannelConfigRecord {
  return {
    channelId: row.channel_id,
    guildId: row.guild_id ?? null,
    channelName: row.channel_name ?? null,
    enabled: parseBool(row.enabled),
    endpointId: row.endpoint_id ?? null,
    presetId: row.preset_id ?? null,
    characterId: row.character_id ?? null,
    triggerMode: row.trigger_mode,
    summaryThreshold: Number(row.summary_threshold ?? 6000),
    maxHistoryTokens: Number(row.max_history_tokens ?? 8000),
    historyMessageLimit: Number(row.history_message_limit ?? 500),
    timeZone: row.time_zone ?? 'Asia/Shanghai',
    silenceThreshold: Number(row.silence_threshold ?? 180),
    toolsEnabled: parseBool(row.tools_enabled),
    maxToolIterations: Number(row.max_tool_iterations ?? 5),
    historyInsertAt: row.history_insert_at ?? 'chatHistory',
    assistantPrefill: row.assistant_prefill ?? '',
    worldbookInlineJson: row.worldbook_inline_json ?? '[]',
    customMacrosJson: row.custom_macros_json ?? '{}',
    activeSessionId: row.active_session_id ?? 'default',
    userDisplayName: row.user_display_name ?? '',
    summarySystemPrompt: row.summary_system_prompt ?? '',
    summaryUserPrompt: row.summary_user_prompt ?? '',
    summaryEndpointId: row.summary_endpoint_id ?? null,
    summaryTemperature: Number(row.summary_temperature ?? 0.2),
    summaryMaxTokens: Number(row.summary_max_tokens ?? 1024),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function insertChannelMessage(input: ChannelMessageInput): ChannelMessageRecord | null {
  const db = openDb()
  const createdAt = input.createdAt ?? nowIso()
  const sessionId = input.sessionId ?? 'default'
  const result = db.prepare(`
    INSERT OR IGNORE INTO channel_messages (
      channel_id, message_id, author_id, author_name, content, role,
      token_count, is_bot, is_summarized, session_id, created_at
    ) VALUES (
      @channelId, @messageId, @authorId, @authorName, @content, @role,
      @tokenCount, @isBot, 0, @sessionId, @createdAt
    )
  `).run({
    channelId: input.channelId,
    messageId: input.messageId,
    authorId: input.authorId,
    authorName: input.authorName,
    content: input.content,
    role: input.role,
    tokenCount: input.tokenCount ?? 0,
    isBot: input.isBot ? 1 : 0,
    sessionId,
    createdAt,
  })

  if (result.changes === 0) return null
  const row = db.prepare('SELECT * FROM channel_messages WHERE message_id = ?').get(input.messageId) as any
  return mapChannelMessage(row)
}

function mapChannelMessage(row: any): ChannelMessageRecord {
  return {
    id: Number(row.id),
    channelId: row.channel_id,
    messageId: row.message_id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    role: row.role,
    tokenCount: Number(row.token_count ?? 0),
    isBot: parseBool(row.is_bot),
    isSummarized: parseBool(row.is_summarized),
    sessionId: row.session_id ?? 'default',
    createdAt: row.created_at,
  }
}

export function updateChannelMessageContent(
  messageId: string,
  content: string,
  tokenCount?: number
): boolean {
  const db = openDb()

  let result
  if (typeof tokenCount === 'number' && Number.isFinite(tokenCount)) {
    result = db
      .prepare(`
        UPDATE channel_messages
        SET content = ?, token_count = ?
        WHERE message_id = ?
      `)
      .run(content, Math.max(0, Math.floor(tokenCount)), messageId)
  } else {
    result = db
      .prepare(`
        UPDATE channel_messages
        SET content = ?
        WHERE message_id = ?
      `)
      .run(content, messageId)
  }

  return result.changes > 0
}

export function updateChannelMessageContentById(
  id: number,
  content: string,
  tokenCount?: number
): boolean {
  const db = openDb()

  let result
  if (typeof tokenCount === 'number' && Number.isFinite(tokenCount)) {
    result = db
      .prepare(`
        UPDATE channel_messages
        SET content = ?, token_count = ?
        WHERE id = ?
      `)
      .run(content, Math.max(0, Math.floor(tokenCount)), id)
  } else {
    result = db
      .prepare(`
        UPDATE channel_messages
        SET content = ?
        WHERE id = ?
      `)
      .run(content, id)
  }

  return result.changes > 0
}

export function deleteChannelMessagesByIds(ids: number[]): number {
  if (ids.length === 0) return 0
  const db = openDb()
  const placeholders = ids.map(() => '?').join(',')
  const result = db
    .prepare(`DELETE FROM channel_messages WHERE id IN (${placeholders})`)
    .run(...ids)
  return Number(result.changes ?? 0)
}

export function deleteChannelMessageByMessageId(messageId: string): boolean {
  const db = openDb()
  const result = db.prepare(`DELETE FROM channel_messages WHERE message_id = ?`).run(messageId)
  return Number(result.changes ?? 0) > 0
}

export function deleteChannelMessagesByMessageIds(messageIds: string[]): number {
  const ids = messageIds.map((x) => String(x).trim()).filter(Boolean)
  if (ids.length === 0) return 0
  const db = openDb()
  const placeholders = ids.map(() => '?').join(',')
  const result = db
    .prepare(`DELETE FROM channel_messages WHERE message_id IN (${placeholders})`)
    .run(...ids)
  return Number(result.changes ?? 0)
}

export function listChannelMessages(channelId: string, limit = 500, sessionId?: string): ChannelMessageRecord[] {
  const db = openDb()
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 500
  const unlimited = normalizedLimit <= 0

  // limit <= 0 表示无限读取（按时间正序）
  if (sessionId) {
    if (unlimited) {
      const rows = db.prepare(`
        SELECT * FROM channel_messages
        WHERE channel_id = ? AND session_id = ?
        ORDER BY created_at ASC
      `).all(channelId, sessionId) as any[]
      return rows.map(mapChannelMessage)
    }

    // 取最新的 N 条消息，然后按时间正序返回（避免只取到最老的一批）
    const rows = db.prepare(`
      SELECT * FROM (
        SELECT * FROM channel_messages
        WHERE channel_id = ? AND session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      ) sub ORDER BY created_at ASC
    `).all(channelId, sessionId, normalizedLimit) as any[]
    return rows.map(mapChannelMessage)
  }

  if (unlimited) {
    const rows = db.prepare(`
      SELECT * FROM channel_messages
      WHERE channel_id = ?
      ORDER BY created_at ASC
    `).all(channelId) as any[]
    return rows.map(mapChannelMessage)
  }

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM channel_messages
      WHERE channel_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) sub ORDER BY created_at ASC
  `).all(channelId, normalizedLimit) as any[]
  return rows.map(mapChannelMessage)
}

export function listUnsummarizedMessages(channelId: string, limit = 500, sessionId?: string): ChannelMessageRecord[] {
  const db = openDb()
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 500
  const unlimited = normalizedLimit <= 0

  // limit <= 0 表示无限读取（按时间正序）
  if (sessionId) {
    if (unlimited) {
      const rows = db.prepare(`
        SELECT * FROM channel_messages
        WHERE channel_id = ? AND is_summarized = 0 AND session_id = ?
        ORDER BY created_at ASC
      `).all(channelId, sessionId) as any[]
      return rows.map(mapChannelMessage)
    }

    // 取最新的 N 条未总结消息，然后按时间正序返回（避免只取到最老的一批）
    const rows = db.prepare(`
      SELECT * FROM (
        SELECT * FROM channel_messages
        WHERE channel_id = ? AND is_summarized = 0 AND session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      ) sub ORDER BY created_at ASC
    `).all(channelId, sessionId, normalizedLimit) as any[]
    return rows.map(mapChannelMessage)
  }

  if (unlimited) {
    const rows = db.prepare(`
      SELECT * FROM channel_messages
      WHERE channel_id = ? AND is_summarized = 0
      ORDER BY created_at ASC
    `).all(channelId) as any[]
    return rows.map(mapChannelMessage)
  }

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM channel_messages
      WHERE channel_id = ? AND is_summarized = 0
      ORDER BY created_at DESC
      LIMIT ?
    ) sub ORDER BY created_at ASC
  `).all(channelId, normalizedLimit) as any[]
  return rows.map(mapChannelMessage)
}

export function markMessagesSummarizedByIds(ids: number[]) {
  if (ids.length === 0) return
  const db = openDb()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE channel_messages SET is_summarized = 1 WHERE id IN (${placeholders})`).run(...ids)
}

export function insertChannelSummary(input: {
  channelId: string
  sessionId?: string
  summary: string
  tokenCount: number
  coversFrom?: string | null
  coversTo?: string | null
  messageCount?: number
}): ChannelSummaryRecord {
  const db = openDb()
  const createdAt = nowIso()
  const sessionId = input.sessionId ?? 'default'
  const result = db.prepare(`
    INSERT INTO channel_summaries (
      channel_id, session_id, summary, token_count, covers_from, covers_to, message_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.channelId,
    sessionId,
    input.summary,
    input.tokenCount,
    input.coversFrom ?? null,
    input.coversTo ?? null,
    input.messageCount ?? 0,
    createdAt
  )
  const row = db
    .prepare('SELECT * FROM channel_summaries WHERE id = ?')
    .get(result.lastInsertRowid) as any
  return mapChannelSummary(row)
}

function mapChannelSummary(row: any): ChannelSummaryRecord {
  return {
    id: Number(row.id),
    channelId: row.channel_id,
    sessionId: row.session_id ?? 'default',
    summary: row.summary,
    tokenCount: Number(row.token_count ?? 0),
    coversFrom: row.covers_from ?? null,
    coversTo: row.covers_to ?? null,
    messageCount: Number(row.message_count ?? 0),
    createdAt: row.created_at,
  }
}

export function listChannelSummaries(channelId: string, sessionId?: string): ChannelSummaryRecord[] {
  const db = openDb()
  if (sessionId) {
    const rows = db.prepare(`
      SELECT * FROM channel_summaries
      WHERE channel_id = ? AND session_id = ?
      ORDER BY created_at DESC
    `).all(channelId, sessionId) as any[]
    return rows.map(mapChannelSummary)
  }
  const rows = db.prepare(`
    SELECT * FROM channel_summaries
    WHERE channel_id = ?
    ORDER BY created_at DESC
  `).all(channelId) as any[]
  return rows.map(mapChannelSummary)
}

export function getChannelSummaryById(id: number): ChannelSummaryRecord | null {
  const db = openDb()
  const row = db.prepare('SELECT * FROM channel_summaries WHERE id = ?').get(id) as any
  return row ? mapChannelSummary(row) : null
}

export function updateChannelSummary(id: number, summary: string, tokenCount: number): boolean {
  const db = openDb()
  const result = db.prepare(`
    UPDATE channel_summaries
    SET summary = ?, token_count = ?
    WHERE id = ?
  `).run(summary, Math.max(0, Math.floor(tokenCount)), id)
  return result.changes > 0
}

export function deleteChannelSummary(id: number): boolean {
  const db = openDb()
  // 先查出总结详情，用于恢复对应消息的 is_summarized 标记
  const summary = db.prepare('SELECT channel_id, session_id, covers_from, covers_to FROM channel_summaries WHERE id = ?').get(id) as any
  if (!summary) return false

  const result = db.prepare('DELETE FROM channel_summaries WHERE id = ?').run(id)
  if (result.changes === 0) return false

  // 恢复该总结覆盖范围内的消息为「未总结」
  if (summary.covers_from && summary.covers_to) {
    const sessionId = summary.session_id ?? 'default'
    db.prepare(`
      UPDATE channel_messages
      SET is_summarized = 0
      WHERE channel_id = ? AND session_id = ? AND is_summarized = 1
        AND created_at >= ? AND created_at <= ?
    `).run(summary.channel_id, sessionId, summary.covers_from, summary.covers_to)
  } else {
    // 没有时间范围信息，保守地恢复该频道+session的全部已总结消息
    const sessionId = summary.session_id ?? 'default'
    db.prepare(`
      UPDATE channel_messages
      SET is_summarized = 0
      WHERE channel_id = ? AND session_id = ? AND is_summarized = 1
    `).run(summary.channel_id, sessionId)
  }

  return true
}

export function upsertEndpoint(input: Omit<EndpointRecord, 'createdAt' | 'updatedAt'>) {
  const db = openDb()
  const prev = db.prepare('SELECT created_at FROM llm_endpoints WHERE id = ?').get(input.id) as any
  const createdAt = prev?.created_at ?? nowIso()
  const updatedAt = nowIso()

  db.prepare(`
    INSERT INTO llm_endpoints (
      id, name, base_url, api_key, model, max_tokens, temperature, top_p, extra_params,
      reasoning_max_tokens, reasoning_effort, show_thinking,
      created_at, updated_at
    ) VALUES (
      @id, @name, @baseUrl, @apiKey, @model, @maxTokens, @temperature, @topP, @extraParams,
      @reasoningMaxTokens, @reasoningEffort, @showThinking,
      @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      base_url=excluded.base_url,
      api_key=excluded.api_key,
      model=excluded.model,
      max_tokens=excluded.max_tokens,
      temperature=excluded.temperature,
      top_p=excluded.top_p,
      extra_params=excluded.extra_params,
      reasoning_max_tokens=excluded.reasoning_max_tokens,
      reasoning_effort=excluded.reasoning_effort,
      show_thinking=excluded.show_thinking,
      updated_at=excluded.updated_at
  `).run({
    ...input,
    reasoningMaxTokens: Math.max(0, Math.floor(Number(input.reasoningMaxTokens ?? 0))),
    reasoningEffort: String(input.reasoningEffort ?? ''),
    showThinking: input.showThinking ? 1 : 0,
    createdAt,
    updatedAt,
  })
}

export function deleteEndpoint(id: string): boolean {
  const db = openDb()
  const result = db.prepare('DELETE FROM llm_endpoints WHERE id = ?').run(id)
  return result.changes > 0
}

export function listEndpoints(): EndpointRecord[] {
  const db = openDb()
  const rows = db.prepare('SELECT * FROM llm_endpoints ORDER BY updated_at DESC').all() as any[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    model: row.model,
    maxTokens: Number(row.max_tokens ?? 2048),
    temperature: Number(row.temperature ?? 0.7),
    topP: Number(row.top_p ?? 1),
    extraParams: row.extra_params ?? '{}',
    reasoningMaxTokens: Number(row.reasoning_max_tokens ?? 0),
    reasoningEffort: String(row.reasoning_effort ?? ''),
    showThinking: parseBool(row.show_thinking),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function deletePreset(id: string): boolean {
  const db = openDb()
  const result = db.prepare('DELETE FROM presets WHERE id = ?').run(id)
  return result.changes > 0
}

export function upsertPreset(input: PresetRecord) {
  const db = openDb()
  db.prepare(`
    INSERT INTO presets (id, name, data, updated_at)
    VALUES (@id, @name, @data, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      data=excluded.data,
      updated_at=excluded.updated_at
  `).run(input)
}

export function listPresets(): PresetRecord[] {
  const db = openDb()
  const rows = db.prepare('SELECT * FROM presets ORDER BY updated_at DESC').all() as any[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    data: r.data,
    updatedAt: r.updated_at,
  }))
}

export function findPresetIdByEndpointId(endpointId: string): string | null {
  if (!endpointId) return null
  const all = listPresets()
  for (const preset of all) {
    try {
      const parsed = JSON.parse(preset.data)
      const bound = String(
        parsed?.apiSetting?.endpointId ?? parsed?.apiSetting?.boundEndpointId ?? ''
      ).trim()
      if (bound === endpointId) {
        return preset.id
      }
    } catch {
      continue
    }
  }
  return null
}

export function getPreset(id: string): PresetRecord | null {
  const db = openDb()
  const row = db.prepare('SELECT * FROM presets WHERE id = ?').get(id) as any | undefined
  if (!row) return null
  return { id: row.id, name: row.name, data: row.data, updatedAt: row.updated_at }
}

export function deleteCharacter(id: string): boolean {
  const db = openDb()
  const result = db.prepare('DELETE FROM characters WHERE id = ?').run(id)
  return result.changes > 0
}

export function upsertCharacter(input: CharacterRecord) {
  const db = openDb()
  db.prepare(`
    INSERT INTO characters (id, name, data, updated_at)
    VALUES (@id, @name, @data, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      data=excluded.data,
      updated_at=excluded.updated_at
  `).run(input)
}

export function listCharacters(): CharacterRecord[] {
  const db = openDb()
  const rows = db.prepare('SELECT * FROM characters ORDER BY updated_at DESC').all() as any[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    data: r.data,
    updatedAt: r.updated_at,
  }))
}

export function setGlobalVariable(key: string, value: string) {
  const db = openDb()
  db.prepare(`
    INSERT INTO global_variables (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value=excluded.value,
      updated_at=excluded.updated_at
  `).run(key, value, nowIso())
}

export function listGlobalVariables(): Record<string, string> {
  const db = openDb()
  const rows = db.prepare('SELECT key, value FROM global_variables').all() as any[]
  const out: Record<string, string> = {}
  for (const row of rows) out[row.key] = row.value
  return out
}

export function setChannelVariable(channelId: string, key: string, value: string) {
  const db = openDb()
  db.prepare(`
    INSERT INTO channel_variables (channel_id, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id, key) DO UPDATE SET
      value=excluded.value,
      updated_at=excluded.updated_at
  `).run(channelId, key, value, nowIso())
}

export function listChannelVariables(channelId: string): Record<string, string> {
  const db = openDb()
  const rows = db
    .prepare('SELECT key, value FROM channel_variables WHERE channel_id = ?')
    .all(channelId) as any[]
  const out: Record<string, string> = {}
  for (const row of rows) out[row.key] = row.value
  return out
}

// ─── Session Management ─────────────────────────────

export function listSessionsForChannel(channelId: string): Array<{ sessionId: string; messageCount: number; lastMessageAt: string | null }> {
  const db = openDb()
  const rows = db.prepare(`
    SELECT session_id, COUNT(*) AS cnt, MAX(created_at) AS last_at
    FROM channel_messages
    WHERE channel_id = ?
    GROUP BY session_id
    ORDER BY last_at DESC
  `).all(channelId) as any[]
  return rows.map((r) => ({
    sessionId: String(r.session_id ?? 'default'),
    messageCount: Number(r.cnt ?? 0),
    lastMessageAt: r.last_at ?? null,
  }))
}

export function switchChannelSession(channelId: string, sessionId: string): ChannelConfigRecord {
  return upsertChannelConfig({ channelId, activeSessionId: sessionId })
}

export function clearChannelSessionHistory(channelId: string, sessionId: string): number {
  const db = openDb()
  const result = db.prepare(`DELETE FROM channel_messages WHERE channel_id = ? AND session_id = ?`).run(channelId, sessionId)
  return Number(result.changes ?? 0)
}

export function clearChannelAllHistory(channelId: string): number {
  const db = openDb()
  const r1 = db.prepare(`DELETE FROM channel_messages WHERE channel_id = ?`).run(channelId)
  const r2 = db.prepare(`DELETE FROM channel_summaries WHERE channel_id = ?`).run(channelId)
  return Number(r1.changes ?? 0) + Number(r2.changes ?? 0)
}

// ─── Batch message operations ───────────────────────

export function updateChannelMessageRole(id: number, role: MessageRole): boolean {
  const db = openDb()
  const result = db.prepare(`UPDATE channel_messages SET role = ? WHERE id = ?`).run(role, id)
  return result.changes > 0
}

export function getChannelMessageById(id: number): ChannelMessageRecord | null {
  const db = openDb()
  const row = db.prepare('SELECT * FROM channel_messages WHERE id = ?').get(id) as any
  return row ? mapChannelMessage(row) : null
}

/**
 * 从 content 中剥离元数据尾注行 (-# Time: ...)
 */
export function stripMetaFooter(content: string): string {
  return content.replace(/\n*-#\s*Time:.*$/s, '').trim()
}