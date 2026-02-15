import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  IntentsBitField,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js'
import { z } from 'zod'
import {
  applyRegex,
  normalizeRegexes,
  type RegexScriptData,
} from 'fast-tavern'
import {
  type ChannelConfigRecord,
  type MessageRole,
  type SummaryConfigRecord,
  getDb,
  getChannelConfig,
  getPreset,
  insertChannelMessage,
  insertChannelSummary,
  listChannelConfigs,
  listChannelMessages,
  listChannelSummaries,
  listChannelVariables,
  listCharacters,
  listEndpoints,
  listGlobalVariables,
  listPresets,
  listUnsummarizedMessages,
  markMessagesSummarizedByIds,
  setChannelVariable,
  setGlobalVariable,
  updateChannelMessageContent,
  updateChannelMessageContentById,
  updateChannelMessageRole,
  deleteChannelMessagesByIds,
  deleteChannelMessageByMessageId,
  deleteChannelMessagesByMessageIds,
  getChannelMessageById,
  getChannelSummaryById,
  updateChannelSummary,
  deleteChannelSummary,
  upsertChannelConfig,
  upsertCharacter,
  upsertEndpoint,
  upsertPreset,
  deleteEndpoint,
  deletePreset,
  deleteCharacter,
  stripMetaFooter,
  listSessionsForChannel,
  switchChannelSession,
  clearChannelSessionHistory,
  clearChannelAllHistory,
  getSummaryConfig,
  upsertSummaryConfig,
  findPresetIdByEndpointId,
} from './db.js'
import { buildPromptHistoryBlock } from './history.js'
import { buildPromptForChannel } from './prompt.js'
import {
  chatCompletions,
  discoverModels,
  streamChatCompletions,
  buildMultimodalContent,
  imageUrlToDataUri,
  extractTextContent,
  type OpenAIMessage,
  type ContentPart,
} from './llm.js'
import { MCPManager } from './mcp.js'
import {
  buildXmlToolSystemPrompt,
  parseXmlToolCalls,
  stripXmlToolCalls,
} from './xmlToolCompat.js'

const app = Fastify({ logger: true })
const mcpManager = new MCPManager({ logger: app.log })

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'

/** Bot 管理员用户 ID 列表（通过环境变量 BOT_ADMIN_IDS 配置，逗号分隔） */
const BOT_ADMIN_IDS = new Set(
  (process.env.BOT_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)

function isBotAdmin(userId: string): boolean {
  // 如果未配置任何管理员，则所有人都可用（方便调试）
  if (BOT_ADMIN_IDS.size === 0) return true
  return BOT_ADMIN_IDS.has(userId)
}

const intentNameMap: Record<string, number> = {
  Guilds: GatewayIntentBits.Guilds,
  GuildMembers: GatewayIntentBits.GuildMembers,
  GuildModeration: GatewayIntentBits.GuildModeration,
  GuildEmojisAndStickers: GatewayIntentBits.GuildEmojisAndStickers,
  GuildIntegrations: GatewayIntentBits.GuildIntegrations,
  GuildWebhooks: GatewayIntentBits.GuildWebhooks,
  GuildInvites: GatewayIntentBits.GuildInvites,
  GuildVoiceStates: GatewayIntentBits.GuildVoiceStates,
  GuildPresences: GatewayIntentBits.GuildPresences,
  GuildMessages: GatewayIntentBits.GuildMessages,
  GuildMessageReactions: GatewayIntentBits.GuildMessageReactions,
  GuildMessageTyping: GatewayIntentBits.GuildMessageTyping,
  DirectMessages: GatewayIntentBits.DirectMessages,
  DirectMessageReactions: GatewayIntentBits.DirectMessageReactions,
  DirectMessageTyping: GatewayIntentBits.DirectMessageTyping,
  MessageContent: GatewayIntentBits.MessageContent,
  GuildScheduledEvents: GatewayIntentBits.GuildScheduledEvents,
  AutoModerationConfiguration: GatewayIntentBits.AutoModerationConfiguration,
  AutoModerationExecution: GatewayIntentBits.AutoModerationExecution,
  GuildMessagePolls: GatewayIntentBits.GuildMessagePolls,
  DirectMessagePolls: GatewayIntentBits.DirectMessagePolls,
}

const verifySchema = z.object({
  token: z.string().min(1, 'token 不能为空'),
  intents: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  clientId: z.string().optional(),
})

const pingSchema = z.object({
  token: z.string().min(1, 'token 不能为空'),
  intents: z.array(z.string()).default(['Guilds']),
})

const discordStartSchema = z.object({
  token: z.string().min(1, 'token 不能为空'),
  intents: z.array(z.string()).default(['Guilds', 'GuildMessages', 'MessageContent']),
})

const channelUpsertSchema = z.object({
  guildId: z.string().nullable().optional(),
  channelName: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  endpointId: z.string().nullable().optional(),
  presetId: z.string().nullable().optional(),
  characterId: z.string().nullable().optional(),
  triggerMode: z.enum(['mention', 'keyword', 'all', 'command', 'dm']).optional(),
  summaryThreshold: z.number().int().optional(),
  maxHistoryTokens: z.number().int().optional(),
  historyMessageLimit: z.number().int().optional(),
  timeZone: z.string().optional(),
  silenceThreshold: z.number().int().optional(),
  toolsEnabled: z.boolean().optional(),
  maxToolIterations: z.number().int().optional(),
  historyInsertAt: z.string().optional(),
  assistantPrefill: z.string().optional(),
  worldbookInlineJson: z.string().optional(),
  customMacrosJson: z.string().optional(),
  activeSessionId: z.string().optional(),
  userDisplayName: z.string().optional(),
  summarySystemPrompt: z.string().optional(),
  summaryUserPrompt: z.string().optional(),
  summaryEndpointId: z.string().nullable().optional(),
  summaryTemperature: z.number().optional(),
  summaryMaxTokens: z.number().int().optional(),
})

const summaryConfigUpsertSchema = z.object({
  summaryThreshold: z.number().int().optional(),
  summarySystemPrompt: z.string().optional(),
  summaryUserPrompt: z.string().optional(),
  summaryEndpointId: z.string().nullable().optional(),
  summaryTemperature: z.number().optional(),
  summaryMaxTokens: z.number().int().optional(),
})

const channelBatchApplySchema = z.object({
  sourceChannelId: z.string().min(1),
  targetChannelIds: z.array(z.string().min(1)).min(1),
  includeEnabled: z.boolean().optional(),
})

const messageEditSchema = z.object({
  content: z.string().min(0),
  role: z.enum(['user', 'bot', 'system', 'model']).optional(),
})

const messageBatchDeleteSchema = z.object({
  ids: z.array(z.number().int()).min(1),
})

const sessionCreateSchema = z.object({
  sessionId: z.string().min(1).max(64),
})

const historyResyncSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
})

const summariesExportSchema = z.object({
  sessionId: z.string().min(1).optional(),
  ids: z.array(z.number().int().positive()).min(1),
})

const summariesImportMergeSchema = z.object({
  sessionId: z.string().min(1).optional(),
  replaceIds: z.array(z.number().int().positive()).min(1),
  summary: z.string().min(1),
})

const endpointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().default(''),
  model: z.string().min(1),
  maxTokens: z.number().int().default(2048),
  temperature: z.number().default(0.7),
  topP: z.number().default(1),
  extraParams: z.string().default('{}'),
  reasoningMaxTokens: z.number().int().min(0).default(0),
  reasoningEffort: z.enum(['', 'auto', 'low', 'medium', 'high']).default(''),
  showThinking: z.boolean().default(false),
})

const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  data: z.string().min(2),
})

const characterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  data: z.string().min(2),
})

const variableSetSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
})

const discoverModelsSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
})

const promptBuildSchema = z.object({
  channelId: z.string().min(1),
  historyLimit: z.number().int().optional(),
  useUnsummarized: z.boolean().optional(),
  includeSummary: z.boolean().optional(),
  outputFormat: z.enum(['openai', 'gemini', 'tagged', 'text']).optional(),
  view: z.enum(['model', 'user']).optional(),
  sessionId: z.string().optional(),
})

const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
})

const llmChatSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string().min(1),
  messages: z.array(llmMessageSchema).min(1),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  maxTokens: z.number().int().optional(),
  extraParams: z.record(z.any()).optional(),
})

type DashboardEventLevel = 'success' | 'warning' | 'info'

function nowIso() {
  return new Date().toISOString()
}

function estimateTokens(text: string): number {
  if (!text) return 0
  // 简化估算：中文和英文混排场景用 1 token ≈ 2 chars
  return Math.ceil(text.length / 2)
}

/**
 * 历史条数限制：<=0 视为无限；>0 取整数；非法值回退 fallback
 */
function normalizeHistoryLimit(value: unknown, fallback = 500): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  if (i <= 0) return 0
  return Math.max(1, i)
}

function getTimeZoneOffsetMinutes(timeZone: string, date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date)

    const tzName = parts.find((x) => x.type === 'timeZoneName')?.value ?? 'GMT+0'
    const m = tzName.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/)
    if (!m) return 0

    const hours = Number(m[1] ?? 0)
    const minutes = Number(m[2] ?? 0)
    const sign = hours < 0 ? -1 : 1
    return hours * 60 + sign * minutes
  } catch {
    return 0
  }
}

function getStartOfTodayIsoByTimeZone(timeZone: string): string {
  const offsetMin = getTimeZoneOffsetMinutes(timeZone, new Date())
  const offsetMs = offsetMin * 60_000
  const shiftedNow = new Date(Date.now() + offsetMs)
  shiftedNow.setUTCHours(0, 0, 0, 0)
  return new Date(shiftedNow.getTime() - offsetMs).toISOString()
}

function normalizeTimeZone(timeZone: string | undefined): string {
  const tz = (timeZone ?? '').trim()
  if (!tz) return 'Asia/Shanghai'
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return 'Asia/Shanghai'
  }
}

function formatTimeInTimeZone(iso: string, timeZone: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)
}

function resolveIntentBits(intentNames: string[]) {
  const unknown: string[] = []
  const bits: number[] = []

  for (const name of intentNames) {
    const bit = intentNameMap[name]
    if (typeof bit !== 'number') {
      unknown.push(name)
      continue
    }
    bits.push(bit)
  }

  if (!bits.includes(GatewayIntentBits.Guilds)) bits.push(GatewayIntentBits.Guilds)

  return {
    bits,
    unknown,
    bitfield: new IntentsBitField(bits).bitfield.toString(),
  }
}

async function verifyBotToken(token: string) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'GET',
    headers: { Authorization: `Bot ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Discord API 鉴权失败: HTTP ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
    id: string
    username: string
    discriminator: string
    global_name?: string | null
    bot?: boolean
  }

  return data
}

function getChannelNameForStore(message: {
  channel: { type: ChannelType; isDMBased?: () => boolean; name?: string | null }
}): string | null {
  if (typeof message.channel.name === 'string' && message.channel.name.length > 0) {
    return message.channel.name
  }
  if (typeof message.channel.isDMBased === 'function' && message.channel.isDMBased()) {
    return 'DM'
  }
  return null
}

/**
 * 将 Discord 消息内容中的 <@用户ID> / <@!用户ID> / <#频道ID> / <@&角色ID>
 * 替换为可读文本，让 LLM 能理解 mention 的含义。
 */
function resolveDiscordMentions(message: any, selfUserId: string | null): string {
  let content = String(message?.content ?? '')
  if (!content) return content

  // 替换用户 mention: <@123456> 或 <@!123456>
  content = content.replace(/<@!?(\d+)>/g, (_match, userId) => {
    // 自己的 mention → 让模型知道有人在叫它
    if (selfUserId && userId === selfUserId) {
      return '**使用@提及了你**'
    }
    // 查找 guild members
    const member = message?.mentions?.members?.get?.(userId)
    if (member?.displayName) return `@${member.displayName}`
    const user = message?.mentions?.users?.get?.(userId)
    if (user?.username) return `@${user.username}`
    return `@用户${userId}` // fallback: 不保留 <> 转义
  })

  // 替换频道 mention: <#123456>
  content = content.replace(/<#(\d+)>/g, (_match, channelId) => {
    const channel = message?.guild?.channels?.cache?.get?.(channelId)
    if (channel?.name) return `#${channel.name}`
    return `#频道${channelId}`
  })

  // 替换角色 mention: <@&123456>
  content = content.replace(/<@&(\d+)>/g, (_match, roleId) => {
    const role = message?.guild?.roles?.cache?.get?.(roleId)
    if (role?.name) return `@${role.name}`
    return `@角色${roleId}`
  })

  return content
}

async function waitForClientReady(
  client: Client,
  timeoutMs: number
): Promise<{ userTag: string; guildCount: number }> {
  if (client.isReady()) {
    return {
      userTag: client.user?.tag ?? 'unknown',
      guildCount: client.guilds.cache.size,
    }
  }

  return await new Promise<{ userTag: string; guildCount: number }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('连接 Discord Gateway 超时'))
    }, timeoutMs)

    const onReady = (readyClient: Client<true>) => {
      cleanup()
      resolve({
        userTag: readyClient.user.tag,
        guildCount: readyClient.guilds.cache.size,
      })
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const cleanup = () => {
      clearTimeout(timeout)
      client.off(Events.ClientReady, onReady)
      client.off(Events.Error, onError)
    }

    client.once(Events.ClientReady, onReady)
    client.once(Events.Error, onError)
  })
}

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // noop
  }
  return {}
}

function parseBooleanCompatFlag(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v !== 'string') return null

  const s = v.trim().toLowerCase()
  if (!s) return null
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return null
}

function splitEndpointExtraParams(raw: string | null | undefined): {
  modelExtraParams: Record<string, unknown>
  useXmlTools: boolean
  forceNativeTools: boolean
} {
  const all = safeParseJsonObject(raw)
  const modelExtraParams: Record<string, unknown> = { ...all }

  const explicitXml =
    parseBooleanCompatFlag(all.useXmlTools) ?? parseBooleanCompatFlag(all.use_xml_tools) ?? false
  const forceNative =
    parseBooleanCompatFlag(all.forceNativeTools) ??
    parseBooleanCompatFlag(all.force_native_tools) ??
    false

  delete modelExtraParams.useXmlTools
  delete modelExtraParams.use_xml_tools
  delete modelExtraParams.forceNativeTools
  delete modelExtraParams.force_native_tools

  return {
    modelExtraParams,
    useXmlTools: explicitXml,
    forceNativeTools: forceNative,
  }
}

function parseDbBool(v: unknown): boolean {
  return Number(v) === 1
}

function mapDbChannelMessageRow(row: any): {
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
} {
  return {
    id: Number(row?.id ?? 0),
    channelId: String(row?.channel_id ?? ''),
    messageId: String(row?.message_id ?? ''),
    authorId: String(row?.author_id ?? ''),
    authorName: String(row?.author_name ?? ''),
    content: String(row?.content ?? ''),
    role: String(row?.role ?? 'user') as MessageRole,
    tokenCount: Number(row?.token_count ?? 0),
    isBot: parseDbBool(row?.is_bot),
    isSummarized: parseDbBool(row?.is_summarized),
    sessionId: String(row?.session_id ?? 'default'),
    createdAt: String(row?.created_at ?? ''),
  }
}

function normalizePositiveIntIds(input: number[]): number[] {
  return Array.from(
    new Set(
      input
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.floor(x))
    )
  )
}

function buildCopiedEndpointId(sourceId: string, existingIds: Set<string>): string {
  const raw = String(sourceId ?? '').trim() || 'endpoint'
  const normalized = raw.replace(/\s+/g, '-')
  const base = `${normalized}-copy`
  let candidate = base
  let index = 2
  while (existingIds.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }
  return candidate
}

function buildCopiedEndpointName(sourceName: string, existingNames: Set<string>): string {
  const raw = String(sourceName ?? '').trim() || 'Endpoint'
  const base = `${raw} Copy`
  let candidate = base
  let index = 2
  while (existingNames.has(candidate)) {
    candidate = `${base} ${index}`
    index += 1
  }
  return candidate
}

function buildCopiedPresetId(sourceId: string, existingIds: Set<string>): string {
  const raw = String(sourceId ?? '').trim() || 'preset'
  const normalized = raw.replace(/\s+/g, '-')
  const base = `${normalized}-copy`
  let candidate = base
  let index = 2
  while (existingIds.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }
  return candidate
}

function buildCopiedPresetName(sourceName: string, existingNames: Set<string>): string {
  const raw = String(sourceName ?? '').trim() || 'Preset'
  const base = `${raw} Copy`
  let candidate = base
  let index = 2
  while (existingNames.has(candidate)) {
    candidate = `${base} ${index}`
    index += 1
  }
  return candidate
}

function resolveEndpointForChannel(cfg: ChannelConfigRecord) {
  if (cfg.endpointId) {
    const found = listEndpoints().find((x) => x.id === cfg.endpointId)
    if (found) return found
  }
  // 回退到默认端点，再回退到列表中第一个
  const endpoints = listEndpoints()
  return endpoints.find((x) => x.id === '__default__') ?? endpoints[0] ?? null
}

function extractPresetBoundEndpointId(rawData: string): string {
  const text = String(rawData ?? '').trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text)
    const endpointId = String(
      parsed?.apiSetting?.endpointId ?? parsed?.apiSetting?.boundEndpointId ?? ''
    ).trim()
    return endpointId
  } catch {
    return ''
  }
}

function resolvePresetForEndpoint(endpointId: string) {
  const target = String(endpointId ?? '').trim()
  if (!target) return null
  const presets = listPresets()
  for (const preset of presets) {
    if (extractPresetBoundEndpointId(preset.data) === target) {
      return preset
    }
  }
  return null
}

function collectValues<T = any>(input: any): T[] {
  if (!input) return []
  if (Array.isArray(input)) return input as T[]

  try {
    if (typeof input.values === 'function') {
      return Array.from(input.values()) as T[]
    }
  } catch {
    // noop
  }

  try {
    if (typeof input[Symbol.iterator] === 'function') {
      return Array.from(input as Iterable<T>)
    }
  } catch {
    // noop
  }

  return []
}

/** 从附件列表提取图片 URL */
function extractImageUrlsFromAttachments(attachments: any): string[] {
  const urls: string[] = []
  for (const att of collectValues<any>(attachments)) {
    const ct = String(att?.contentType ?? '').toLowerCase()
    if (ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(att?.name ?? '')) {
      urls.push(att?.url ?? att?.proxyURL ?? att?.proxyUrl ?? '')
    }
  }
  return urls.filter(Boolean)
}

/** 从 embed 列表提取可能的图片 URL */
function extractImageUrlsFromEmbeds(embedsInput: any): string[] {
  const urls: string[] = []
  for (const embed of collectValues<any>(embedsInput)) {
    const imageUrl = String(embed?.image?.url ?? '').trim()
    const thumbnailUrl = String(embed?.thumbnail?.url ?? '').trim()
    const embedType = String(embed?.type ?? '').toLowerCase()
    const embedUrl = String(embed?.url ?? '').trim()

    if (imageUrl) urls.push(imageUrl)
    if (thumbnailUrl) urls.push(thumbnailUrl)
    if (embedType === 'image' && embedUrl) urls.push(embedUrl)
  }
  return urls.filter(Boolean)
}

/** 从消息文本中提取自定义表情 URL（<:name:id> / <a:name:id>） */
function extractCustomEmojiUrlsFromContent(content: string): string[] {
  const text = String(content ?? '')
  if (!text) return []

  const urls: string[] = []
  const re = /<(a?):([A-Za-z0-9_~\-]+):(\d+)>/g
  let m: RegExpExecArray | null = null

  while ((m = re.exec(text)) !== null) {
    const animatedFlag = String(m[1] ?? '')
    const emojiId = String(m[3] ?? '').trim()
    if (!emojiId) continue
    const ext = animatedFlag === 'a' ? 'gif' : 'png'
    urls.push(`https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=96&quality=lossless`)
  }

  return dedupeStrings(urls)
}

/** 从 Discord 消息对象中提取图片 URL（附件 + embeds + 自定义表情） */
function extractDiscordImageUrls(message: any): string[] {
  const fromAttachments = extractImageUrlsFromAttachments(message?.attachments)
  const fromEmbeds = extractImageUrlsFromEmbeds(message?.embeds)
  const fromCustomEmojis = extractCustomEmojiUrlsFromContent(String(message?.content ?? ''))
  return dedupeStrings([...fromAttachments, ...fromEmbeds, ...fromCustomEmojis])
}

const MAX_TEXT_ATTACHMENT_BYTES = 64 * 1024
const MAX_TEXT_ATTACHMENT_CHARS = 4000
const MAX_TEXT_ATTACHMENTS_PER_MESSAGE = 3

function isTxtOrJsonAttachment(att: any): boolean {
  const contentType = String(att?.contentType ?? '').toLowerCase()
  const name = String(att?.name ?? '').toLowerCase()

  if (
    contentType.includes('text/plain') ||
    contentType.includes('application/json') ||
    contentType.includes('text/json')
  ) {
    return true
  }

  return /\.(txt|json)$/i.test(name)
}

function clipTextAttachmentContent(text: string): string {
  if (text.length <= MAX_TEXT_ATTACHMENT_CHARS) return text
  return `${text.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n...(附件文本过长，已截断)`
}

async function downloadTextAttachment(url: string): Promise<string | null> {
  const target = String(url ?? '').trim()
  if (!target) return null

  try {
    const res = await fetch(target, { redirect: 'follow' })
    if (!res.ok) return null

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length <= 0) return null

    const clipped = buf.length > MAX_TEXT_ATTACHMENT_BYTES ? buf.subarray(0, MAX_TEXT_ATTACHMENT_BYTES) : buf
    let text = clipped.toString('utf8').replace(/\u0000/g, '').trim()
    if (!text) return null
    if (buf.length > MAX_TEXT_ATTACHMENT_BYTES) {
      text = `${text}\n...(附件过大，已按字节截断)`
    }
    return text
  } catch {
    return null
  }
}

async function extractTextAttachmentBlocks(message: any, labelPrefix = '附件'): Promise<string[]> {
  const atts = collectValues<any>(message?.attachments)
    .filter(isTxtOrJsonAttachment)
    .slice(0, MAX_TEXT_ATTACHMENTS_PER_MESSAGE)

  const blocks: string[] = []
  for (let i = 0; i < atts.length; i++) {
    const att = atts[i]
    const name = String(att?.name ?? `file-${i + 1}`)
    const url = String(att?.url ?? att?.proxyURL ?? att?.proxyUrl ?? '').trim()
    const raw = await downloadTextAttachment(url)

    if (!raw) {
      if (url) {
        blocks.push(`[${labelPrefix}${i + 1}] ${name}\n(未能读取附件文本内容)\n${url}`)
      }
      continue
    }

    const clipped = clipTextAttachmentContent(raw)
    blocks.push(`[${labelPrefix}${i + 1}] ${name}\n${clipped}`)
  }
  return blocks
}

function dedupeStrings(values: string[]): string[] {
  const set = new Set<string>()
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (s) set.add(s)
  }
  return Array.from(set)
}

async function fetchChannelMessageById(channel: any, messageId: string): Promise<any | null> {
  if (!channel || typeof messageId !== 'string' || !messageId.trim()) return null
  if (!('messages' in channel)) return null

  try {
    const cached = channel.messages?.cache?.get?.(messageId)
    if (cached) return cached
  } catch {
    // noop
  }

  try {
    const fetched = await channel.messages.fetch(messageId)
    return fetched ?? null
  } catch {
    return null
  }
}

async function fetchReferencedMessage(message: any): Promise<any | null> {
  const refId = String(message?.reference?.messageId ?? '').trim()
  if (!refId) return null
  const channel = message?.channel
  return await fetchChannelMessageById(channel, refId)
}

function resolveMessageAuthorName(message: any): string {
  return (
    message?.member?.displayName ??
    message?.author?.globalName ??
    message?.author?.username ??
    message?.authorName ??
    '未知用户'
  )
}

function extractEmbedText(message: any): string {
  const lines: string[] = []
  for (const embed of collectValues<any>(message?.embeds)) {
    const title = String(embed?.title ?? '').trim()
    const description = String(embed?.description ?? '').trim()
    if (title) lines.push(title)
    if (description) lines.push(description)

    const fields = collectValues<any>(embed?.fields)
    for (const f of fields) {
      const name = String(f?.name ?? '').trim()
      const value = String(f?.value ?? '').trim()
      if (name && value) lines.push(`${name}: ${value}`)
      else if (value) lines.push(value)
      else if (name) lines.push(name)
    }
  }
  return lines.join('\n').trim()
}

function normalizeMessageContentForStore(message: any, selfUserId: string | null): string {
  const base = resolveDiscordMentions(message, selfUserId).trim()
  const embedText = extractEmbedText(message)
  return [base, embedText].filter(Boolean).join('\n').trim()
}

interface ForwardSnapshotData {
  authorName: string
  content: string
  imageUrls: string[]
}

function getForwardedSnapshots(message: any, selfUserId: string | null): ForwardSnapshotData[] {
  const snapshots = collectValues<any>(message?.messageSnapshots)
  const result: ForwardSnapshotData[] = []

  for (const rawSnapshot of snapshots) {
    const snapshot = rawSnapshot?.message ?? rawSnapshot
    if (!snapshot) continue

    const content = normalizeMessageContentForStore(snapshot, selfUserId)
    const imageUrls = extractDiscordImageUrls(snapshot)
    if (!content && imageUrls.length === 0) continue

    result.push({
      authorName: resolveMessageAuthorName(snapshot),
      content,
      imageUrls,
    })
  }

  return result
}

function buildForwardedSnapshotBlock(
  snapshot: ForwardSnapshotData,
  index: number,
  prefix = '转发'
): string {
  const text = String(snapshot.content ?? '').trim()
  const imageUrls = dedupeStrings(snapshot.imageUrls ?? [])
  if (!text && imageUrls.length === 0) return ''

  const lines: string[] = []
  lines.push(`[${prefix}消息${index}] ${snapshot.authorName}:`)
  if (text) lines.push(text)
  if (imageUrls.length > 0) {
    lines.push(...imageUrls.map((u, i) => `[${prefix}图片${index}-${i + 1}] ${u}`))
  }
  return lines.join('\n')
}

function buildQuotedMessageBlock(input: {
  authorName: string
  content: string
  imageUrls: string[]
}): string {
  const text = String(input.content ?? '').trim()
  const imageUrls = dedupeStrings(input.imageUrls ?? [])
  if (!text && imageUrls.length === 0) return ''

  const lines: string[] = []
  const author = input.authorName?.trim() || '未知用户'
  lines.push(`[引用消息] ${author}:`)
  if (text) lines.push(text)
  if (imageUrls.length > 0) {
    lines.push(...imageUrls.map((u, i) => `[引用图片${i + 1}] ${u}`))
  }
  return lines.join('\n')
}

async function buildStoredDiscordMessageContent(
  message: any,
  selfUserId: string | null
): Promise<{ content: string; imageUrls: string[] }> {
  const content = normalizeMessageContentForStore(message, selfUserId)
  const ownImageUrls = extractDiscordImageUrls(message)
  const ownTextAttachmentBlocks = await extractTextAttachmentBlocks(message, '附件')
  const ownForwarded = getForwardedSnapshots(message, selfUserId)
  const ownForwardedImageUrls = ownForwarded.flatMap((x) => x.imageUrls)
  const blocks: string[] = []

  if (content) blocks.push(content)
  if (ownImageUrls.length > 0) {
    blocks.push(ownImageUrls.map((u, i) => `[图片${i + 1}] ${u}`).join('\n'))
  }
  if (ownTextAttachmentBlocks.length > 0) {
    blocks.push(...ownTextAttachmentBlocks)
  }
  for (let i = 0; i < ownForwarded.length; i++) {
    const block = buildForwardedSnapshotBlock(ownForwarded[i], i + 1, '转发')
    if (block) blocks.push(block)
  }

  const referencedMessage = await fetchReferencedMessage(message)
  let quotedImageUrls: string[] = []
  if (referencedMessage) {
    const quotedAuthor = resolveMessageAuthorName(referencedMessage)

    let quotedContent = normalizeMessageContentForStore(referencedMessage, selfUserId)
    if (referencedMessage?.author?.id && selfUserId && referencedMessage.author.id === selfUserId) {
      quotedContent = stripMetaFooter(quotedContent)
    }

    const referencedForwarded = getForwardedSnapshots(referencedMessage, selfUserId)
    const referencedForwardedImageUrls = referencedForwarded.flatMap((x) => x.imageUrls)

    if (referencedForwarded.length > 0) {
      const forwardBlocks: string[] = []
      for (let i = 0; i < referencedForwarded.length; i++) {
        const b = buildForwardedSnapshotBlock(referencedForwarded[i], i + 1, '引用转发')
        if (b) forwardBlocks.push(b)
      }
      quotedContent = [quotedContent, ...forwardBlocks].filter(Boolean).join('\n\n').trim()
    }

    const quotedTextAttachmentBlocks = await extractTextAttachmentBlocks(referencedMessage, '引用附件')
    if (quotedTextAttachmentBlocks.length > 0) {
      quotedContent = [quotedContent, ...quotedTextAttachmentBlocks].filter(Boolean).join('\n\n').trim()
    }

    quotedImageUrls = dedupeStrings([
      ...extractDiscordImageUrls(referencedMessage),
      ...referencedForwardedImageUrls,
    ])

    const quoteBlock = buildQuotedMessageBlock({
      authorName: quotedAuthor,
      content: quotedContent,
      imageUrls: quotedImageUrls,
    })
    if (quoteBlock) blocks.push(quoteBlock)
  }

  return {
    content: blocks.join('\n\n').trim(),
    imageUrls: dedupeStrings([...ownImageUrls, ...ownForwardedImageUrls, ...quotedImageUrls]),
  }
}

function extractAllImageUrlsFromMessage(message: any): string[] {
  const direct = extractDiscordImageUrls(message)
  const forwarded = getForwardedSnapshots(message, null).flatMap((x) => x.imageUrls)
  return dedupeStrings([...direct, ...forwarded])
}

async function collectImageUrlsForGeneration(message: any): Promise<string[]> {
  const ownImageUrls = extractAllImageUrlsFromMessage(message)
  const referenced = await fetchReferencedMessage(message)
  const quotedImageUrls = referenced ? extractAllImageUrlsFromMessage(referenced) : []
  return dedupeStrings([...ownImageUrls, ...quotedImageUrls])
}

async function createAssistantPlaceholder(trigger: any): Promise<any> {
  if (trigger?.author?.id && typeof trigger?.reply === 'function') {
    return await trigger.reply('思考中...')
  }

  const channel = trigger?.channel ?? trigger
  if (channel && typeof channel.send === 'function') {
    return await channel.send('思考中...')
  }

  throw new Error('无法发送回复：当前上下文不支持发送消息')
}

function normalizeOpenAIRole(raw: unknown): OpenAIMessage['role'] {
  const r = String(raw ?? 'user').toLowerCase()
  if (r === 'assistant' || r === 'model') return 'assistant'
  if (r === 'system') return 'system'
  if (r === 'tool') return 'tool'
  return 'user'
}

function extractMessageContent(x: any): string {
  if (typeof x?.content === 'string') return x.content
  if (Array.isArray(x?.parts)) {
    return x.parts
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('')
  }
  return ''
}

function toOpenAIMessages(output: unknown): OpenAIMessage[] {
  if (!Array.isArray(output)) return []

  const raw: OpenAIMessage[] = []
  for (const item of output as any[]) {
    const role = normalizeOpenAIRole(item?.role)
    const content = extractMessageContent(item)
    // 过滤空 system 消息（content 长度为 0 的 system 不发给 LLM）
    if (!content && role === 'system') continue
    if (!content && role !== 'tool') continue
    raw.push({
      role,
      content,
      ...(typeof item?.name === 'string' ? { name: item.name } : {}),
      ...(typeof item?.tool_call_id === 'string' ? { tool_call_id: item.tool_call_id } : {}),
    })
  }

  // 合并连续的 system 消息
  const out: OpenAIMessage[] = []
  for (const msg of raw) {
    const prev = out[out.length - 1]
    if (msg.role === 'system' && prev?.role === 'system') {
      // 合并到上一条 system 消息
      prev.content = `${extractTextContent(prev.content)}\n\n${extractTextContent(msg.content)}`
    } else {
      out.push(msg)
    }
  }
  return out
}

function demoteSystemMessagesExceptFirst(messages: OpenAIMessage[]): OpenAIMessage[] {
  let seenFirstSystem = false
  return messages.map((msg) => {
    if (msg.role !== 'system') return msg
    if (!seenFirstSystem) {
      seenFirstSystem = true
      return msg
    }
    return {
      ...msg,
      role: 'user',
    }
  })
}

function isDmMessage(message: any): boolean {
  return typeof message?.channel?.isDMBased === 'function' && message.channel.isDMBased()
}

function shouldTriggerReply(message: any, cfg: ChannelConfigRecord, selfUserId: string | null): boolean {
  const text = String(message?.content ?? '').trim()
  const mode = cfg.triggerMode

  if (mode === 'all') return true
  if (mode === 'dm') return isDmMessage(message)
  if (mode === 'command') return text.startsWith('!ai')
  if (mode === 'keyword') {
    const s = text.toLowerCase()
    return s.includes('灰魂') || s.includes('assistant') || s.includes('bot')
  }

  // mention（默认）
  if (!selfUserId) return false
  return Boolean(message?.mentions?.users?.has?.(selfUserId))
}

function clipDiscordContent(text: string, maxLen = 1990): string {
  if (text.length <= maxLen) return text
  const suffix = '\n\n...(内容过长，已截断)'
  const budget = Math.max(0, maxLen - suffix.length)
  // 按 code point 遍历，避免在 surrogate pair 中间截断（保护 Unicode 装饰字符）
  let result = ''
  let len = 0
  for (const cp of text) {
    if (len + cp.length > budget) break
    result += cp
    len += cp.length
  }
  return `${result}${suffix}`
}

function formatReplyMetaLine(input: {
  elapsedMs: number
  inputTokens: number
  outputTokens: number
  iterations: number
}): string {
  const sec = Math.max(0.1, input.elapsedMs / 1000)
  const secText = sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)
  return `-# Time: ${secText}s | Input: ${Math.max(0, input.inputTokens)} | Output: ${Math.max(0, input.outputTokens)} | Iterations: ${Math.max(1, input.iterations)}`
}

function getToolDefinitionsForChannel(_channelId: string): unknown[] {
  return mcpManager.getOpenAITools()
}

function buildXmlToolPromptMacroForChannel(channelId: string, cfg: ChannelConfigRecord): string {
  const endpoint = resolveEndpointForChannel(cfg)
  if (!endpoint) return ''

  const tools = cfg.toolsEnabled ? getToolDefinitionsForChannel(channelId) : []

  const { useXmlTools: explicitXmlTools, forceNativeTools } = splitEndpointExtraParams(
    endpoint.extraParams
  )
  const autoXmlTools = /claude/i.test(endpoint.model)
  const useXmlToolCompat = !forceNativeTools && (explicitXmlTools || autoXmlTools)

  if (!useXmlToolCompat) return ''
  return buildXmlToolSystemPrompt(tools)
}

/** 默认总结 system 提示词 */
const DEFAULT_SUMMARY_SYSTEM_PROMPT =
  '你是对话压缩器。请将群聊对话压缩为可长期记忆的摘要：保留事实、关系、偏好、待办、约定、关键上下文；必须保留每段对话发生的时间（日期和时间段）；避免废话；使用中文。'

/** 默认总结 user 提示词模板，{{chatLog}} 会被替换为聊天记录 */
const DEFAULT_SUMMARY_USER_PROMPT = [
  '请总结以下群聊日志，注意保留每个事件/话题发生的时间信息：',
  '',
  '{{chatLog}}',
  '',
  '输出格式：',
  '1) 核心事实（标注发生时间）',
  '2) 进行中事项（标注最后提及时间）',
  '3) 角色关系/设定变化',
  '4) 可复用记忆条目',
].join('\n')

function resolveSummaryEndpoint(
  cfg: ChannelConfigRecord,
  summaryCfg: Pick<SummaryConfigRecord, 'summaryEndpointId'>
) {
  // 优先使用全局专用总结端点
  if (summaryCfg.summaryEndpointId) {
    const found = listEndpoints().find((x) => x.id === summaryCfg.summaryEndpointId)
    if (found) return found
  }
  // 回退到频道主端点
  return resolveEndpointForChannel(cfg)
}

const SUMMARY_CONTEXT_LIMIT = 3
function buildPreviousSummariesContext(input: {
  channelId: string
  sessionId?: string
  maxItems?: number
  excludeSummaryId?: number
  beforeCreatedAt?: string
}): string {
  const maxItemsRaw = Number(input.maxItems ?? SUMMARY_CONTEXT_LIMIT)
  const maxItems = Number.isFinite(maxItemsRaw) ? Math.max(0, Math.floor(maxItemsRaw)) : SUMMARY_CONTEXT_LIMIT
  if (maxItems <= 0) return ''

  const beforeMs = input.beforeCreatedAt ? new Date(input.beforeCreatedAt).getTime() : Number.NaN

  const picked = listChannelSummaries(input.channelId, input.sessionId)
    .filter((s) => {
      if (typeof input.excludeSummaryId === 'number' && s.id === input.excludeSummaryId) return false
      if (Number.isFinite(beforeMs)) {
        const createdAtMs = new Date(s.createdAt).getTime()
        if (!Number.isFinite(createdAtMs) || createdAtMs >= beforeMs) return false
      }
      return true
    })
    .slice(0, maxItems)
    .reverse()

  if (picked.length === 0) return ''

  const lines: string[] = []
  for (let i = 0; i < picked.length; i++) {
    const s = picked[i]
    const from = s.coversFrom ?? '未知'
    const to = s.coversTo ?? '未知'
    lines.push(`[历史总结${i + 1}] 覆盖区间: ${from} ~ ${to}`)
    lines.push(s.summary.trim())
    lines.push('')
  }
  return lines.join('\n').trim()
}

async function maybeSummarizeChannel(
  channelId: string,
  cfg: ChannelConfigRecord,
  knownInputTokens?: number,
  options?: { force?: boolean }
) {
  try {
    const summaryCfg = getSummaryConfig()
    const endpoint = resolveSummaryEndpoint(cfg, summaryCfg)
    if (!endpoint) {
      app.log.debug({ channelId }, 'summary skipped: no endpoint resolved')
      return
    }

    const unsummarized = listUnsummarizedMessages(channelId, 2000, cfg.activeSessionId)
    if (unsummarized.length === 0) {
      app.log.debug({ channelId, sessionId: cfg.activeSessionId }, 'summary skipped: no unsummarized messages')
      return
    }

    const estimatedTokens = unsummarized.reduce((acc, m) => acc + Math.max(0, Number(m.tokenCount || 0)), 0)
    // 优先使用上游返回的真实 input token 数（包含了所有历史），回退到 DB 估算
    const totalTokens = (knownInputTokens && knownInputTokens > 0) ? knownInputTokens : estimatedTokens
    const effectiveThreshold = options?.force ? 0 : summaryCfg.summaryThreshold
    app.log.info(
      {
        channelId,
        sessionId: cfg.activeSessionId,
        unsummarizedCount: unsummarized.length,
        estimatedTokens,
        knownInputTokens: knownInputTokens ?? null,
        totalTokens,
        summaryThreshold: effectiveThreshold,
        force: Boolean(options?.force),
      },
      `summary check: ${totalTokens}/${effectiveThreshold} tokens (${unsummarized.length} msgs, known=${knownInputTokens ?? 'n/a'})`
    )
    if (totalTokens < Math.max(1, effectiveThreshold)) return

    const historyBlock = buildPromptHistoryBlock(unsummarized, {
      timeZone: cfg.timeZone,
      silenceThresholdMinutes: cfg.silenceThreshold,
    })

    // 使用全局总结配置中的提示词，为空时回退到默认值
    const systemPrompt = summaryCfg.summarySystemPrompt?.trim() || DEFAULT_SUMMARY_SYSTEM_PROMPT
    const userTemplate = summaryCfg.summaryUserPrompt?.trim() || DEFAULT_SUMMARY_USER_PROMPT
    const userContent = userTemplate.replace(/\{\{chatLog\}\}/gi, historyBlock.mergedUserContent)
    const previousSummaryContext = buildPreviousSummariesContext({
      channelId,
      sessionId: cfg.activeSessionId,
      maxItems: SUMMARY_CONTEXT_LIMIT,
    })

    const previousSummaryMessages: OpenAIMessage[] = previousSummaryContext
      ? [
          {
            role: 'system',
            content:
              '你会先收到“已有历史总结”作为上下文，再收到“新增聊天日志”。请在继承历史的前提下进行增量压缩，避免重复复述旧内容。',
          },
          { role: 'user', content: `【已有历史总结】\n${previousSummaryContext}` },
        ]
      : []

    const summaryMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...previousSummaryMessages,
      { role: 'user', content: userContent },
    ]

    const summaryTemperature = summaryCfg.summaryTemperature ?? 0.2
    const summaryMaxTokens = summaryCfg.summaryMaxTokens > 0
      ? summaryCfg.summaryMaxTokens
      : Math.max(256, Math.floor(endpoint.maxTokens * 0.6))

    const out = await chatCompletions({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      messages: summaryMessages,
      temperature: summaryTemperature,
      topP: 1,
      maxTokens: summaryMaxTokens,
      extraParams: safeParseJsonObject(endpoint.extraParams),
      stream: false,
    })

    const summaryText = out.content.trim()
    if (!summaryText) return

    insertChannelSummary({
      channelId,
      sessionId: cfg.activeSessionId ?? 'default',
      summary: summaryText,
      tokenCount: estimateTokens(summaryText),
      coversFrom: unsummarized[0]?.createdAt ?? null,
      coversTo: unsummarized[unsummarized.length - 1]?.createdAt ?? null,
      messageCount: unsummarized.length,
    })

    markMessagesSummarizedByIds(unsummarized.map((m) => m.id))
    app.log.info(
      {
        channelId,
        summarized: unsummarized.length,
        totalTokens,
      },
      'channel summarized'
    )
  } catch (error) {
    app.log.error({ err: error, channelId }, 'failed to summarize channel')
  }
}

interface SimpleRegexScript {
  name: string
  findRegex: string
  replaceRegex: string
  trimStrings: string[]
}

/**
 * 从预设中提取 aiOutput 正则脚本，用于流式展示时动态过滤
 */
function getAiOutputRegexScripts(cfg: ChannelConfigRecord): SimpleRegexScript[] {
  if (!cfg.presetId) return []
  const presetRow = getPreset(cfg.presetId)
  if (!presetRow) return []
  try {
    const parsed = JSON.parse(presetRow.data)
    const rawScripts = Array.isArray(parsed?.regexScripts) ? parsed.regexScripts : []

    const result: SimpleRegexScript[] = []
    for (const s of rawScripts) {
      if (!s || typeof s !== 'object') continue
      if (s.enabled === false) continue
      const targets = Array.isArray(s.targets) ? s.targets : []
      if (!targets.includes('aiOutput')) continue

      result.push({
        name: String(s.name ?? ''),
        findRegex: String(s.findRegex ?? ''),
        replaceRegex: String(s.replaceRegex ?? ''),
        trimStrings: Array.isArray(s.trimRegex) ? s.trimRegex.map(String) : [],
      })
    }
    return result
  } catch {
    return []
  }
}

/**
 * 解析 findRegex 字符串为 RegExp（支持 /pattern/flags 和纯 pattern）
 */
function parseFindRegex(input: string): RegExp | null {
  const s = String(input ?? '').trim()
  if (!s) return null

  if (s.startsWith('/')) {
    // 从后往前找最后一个 '/'
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i] !== '/') continue
      const source = s.slice(1, i)
      const flags = s.slice(i + 1)
      if (/^[gimsuy]*$/.test(flags)) {
        try { return new RegExp(source, flags) } catch { return null }
      }
      break
    }
  }
  try { return new RegExp(s, 'g') } catch { return null }
}

/**
 * 对文本应用一组简化的正则脚本（完全内联实现，不依赖 fast-tavern 运行时）
 */
function applySimpleRegexScripts(text: string, scripts: SimpleRegexScript[]): string {
  let result = text
  for (const script of scripts) {
    const re = parseFindRegex(script.findRegex)
    if (!re) continue

    result = result.replace(re, (...args: any[]) => {
      let match = String(args[0] ?? '')

      // 应用 trim
      for (const trim of script.trimStrings) {
        if (trim) match = match.split(trim).join('')
      }

      // 替换 {{match}} 和 $& 和 $1..$9
      let out = script.replaceRegex
      out = out.replace(/\{\{\s*match\s*\}\}/gi, match)
      out = out.replace(/\$&/g, match)
      out = out.replace(/\$(\d)/g, (_m, n) => {
        const idx = Number(n)
        return idx > 0 ? String(args[idx] ?? '') : ''
      })
      return out
    })
  }
  return result
}

async function generateChannelReply(message: any, cfg: ChannelConfigRecord): Promise<number> {
  const endpoint = resolveEndpointForChannel(cfg)
  if (!endpoint) return 0

  const tools = cfg.toolsEnabled ? getToolDefinitionsForChannel(cfg.channelId) : []
  const normalizedTools = tools.length > 0 ? tools : undefined
  const {
    modelExtraParams,
    useXmlTools: explicitXmlTools,
    forceNativeTools,
  } = splitEndpointExtraParams(endpoint.extraParams)
  const autoXmlTools = /claude/i.test(endpoint.model)
  const useXmlToolCompat =
    Boolean(Array.isArray(normalizedTools) && normalizedTools.length > 0) &&
    !forceNativeTools &&
    (explicitXmlTools || autoXmlTools)

  app.log.info(
    {
      channelId: cfg.channelId,
      model: endpoint.model,
      useXmlToolCompat,
      explicitXmlTools,
      autoXmlTools,
      forceNativeTools,
      toolCount: normalizedTools?.length ?? 0,
    },
    'tool call compatibility mode resolved'
  )

  const xmlToolPrompt =
    useXmlToolCompat && normalizedTools ? buildXmlToolSystemPrompt(normalizedTools) : ''

  const built = buildPromptForChannel(cfg.channelId, {
    historyLimit: normalizeHistoryLimit(cfg.historyMessageLimit, 500),
    useUnsummarized: true,
    includeSummary: true,
    outputFormat: 'openai',
    view: 'model',
    sessionId: cfg.activeSessionId,
    extraMacros: {
      xmlToolPrompt,
    },
  })

  const llmMessagesRaw = toOpenAIMessages(built.result.stages.output.afterPostRegex)
  const llmMessages = demoteSystemMessagesExceptFirst(llmMessagesRaw)
  if (llmMessages.length === 0) return 0

  // 多模态：提取触发消息 + 引用消息中的图片，下载转 base64 data URI 后注入到最后一条 user 消息
  const imageUrls = await collectImageUrlsForGeneration(message)
  if (imageUrls.length > 0) {
    const dataUris = (await Promise.all(imageUrls.map(imageUrlToDataUri))).filter(Boolean) as string[]
    if (dataUris.length > 0) {
      for (let i = llmMessages.length - 1; i >= 0; i--) {
        if (llmMessages[i].role === 'user') {
          const text = extractTextContent(llmMessages[i].content)
          llmMessages[i] = { ...llmMessages[i], content: buildMultimodalContent(text, dataUris) }
          break
        }
      }
    }
  }

  // ⭐ 提取 aiOutput 正则脚本，用于流式展示时动态过滤
  const aiOutputScripts = getAiOutputRegexScripts(cfg)
  app.log.info(
    {
      channelId: cfg.channelId,
      presetId: cfg.presetId,
      regexCount: aiOutputScripts.length,
      regexNames: aiOutputScripts.map((s) => s.name),
    },
    'aiOutput regex scripts loaded'
  )

  const assistantMessage = await createAssistantPlaceholder(message)

  // 占位消息先不存入 DB — 最终会用正文覆盖

  const startedAtMs = Date.now()
  const estimatedInputTokens = estimateTokens(
    llmMessages.map((m) => extractTextContent(m.content)).join('\n')
  )
  const reasoningEffort = (['', 'auto', 'low', 'medium', 'high'] as const).includes(
    endpoint.reasoningEffort as any
  )
    ? (endpoint.reasoningEffort as '' | 'auto' | 'low' | 'medium' | 'high')
    : ''

  let outputText = cfg.assistantPrefill ?? ''
  /** 跨轮次累积的展示文本（含之前轮次的正文 + 工具调用摘要），用于 Discord 展示 */
  let displayPrefix = cfg.assistantPrefill ?? ''
  let thinkingText = ''
  let toolCallCount = 0
  let modelIterations = 0
  let firstIterUsageInput = 0
  let usageInput = 0
  let usageOutput = 0
  let usageTotal = 0
  let lastEditAt = 0

  /** 对文本应用 aiOutput 正则（用于 Discord 展示） */
  const applyDisplayRegex = (text: string): string => {
    if (aiOutputScripts.length === 0) return text
    return applySimpleRegexScripts(text, aiOutputScripts)
  }

  const flushEdit = async (force = false) => {
    const now = Date.now()
    if (!force && now - lastEditAt < 450) return
    lastEditAt = now
    const displayText = applyDisplayRegex(outputText)
    // 流式期间加一个临时 footer（用已有的估算值），避免流结束时闪烁
    const elapsed = Date.now() - startedAtMs
    const tempFooter = formatReplyMetaLine({
      elapsedMs: elapsed,
      inputTokens: usageInput > 0 ? usageInput : estimatedInputTokens,
      outputTokens: usageOutput > 0 ? usageOutput : estimateTokens(outputText),
      iterations: 1,
    })

    const showThinkingNow = endpoint.showThinking && thinkingText.trim().length > 0
    const thinkingPreview = showThinkingNow
      ? (thinkingText.length > 1200 ? `${thinkingText.slice(0, 1200)}\n...(思考内容过长，已折叠)` : thinkingText)
      : ''

    const bodyParts: string[] = []
    if (showThinkingNow) {
      bodyParts.push('**思考中**')
      bodyParts.push(thinkingPreview)
    }
    if (displayText.trim()) {
      if (showThinkingNow) bodyParts.push('---')
      bodyParts.push(displayText)
    } else if (!showThinkingNow) {
      bodyParts.push('思考中...')
    }

    const body = bodyParts.join('\n\n').trim() || '思考中...'
    const content = clipDiscordContent(`${body}\n\n${tempFooter}`)
    await assistantMessage.edit(content)
  }

  try {
    await flushEdit(true)

    {
      // 统一流式处理：有工具时多轮迭代，无工具时单轮
      const hasTools = Array.isArray(normalizedTools) && normalizedTools.length > 0
      const maxIterations = hasTools
        ? Math.max(1, Math.floor(Number(cfg.maxToolIterations || 1)))
        : 1
      const messagesForLoop: OpenAIMessage[] = [...llmMessages]
      let gotFinalResponse = false

      for (let iter = 0; iter < maxIterations; iter++) {
        modelIterations += 1

        // ── 本轮流式累积变量 ──
        let iterContent = ''
        let xmlToolDetectedMidStream = false
        const nativeToolCallMap = new Map<number, { id: string; name: string; arguments: string }>()
        // 用于检测完整 XML 工具调用块的正则
        const xmlToolBlockRe = /<<<tool_call>>>[\s\S]*?<<<\/tool_call>>>/i
        // 本轮 usage（覆盖语义：同一轮内多个 packet 的 usage 取最后一次）
        let iterUsageInput = 0
        let iterUsageOutput = 0
        let iterUsageTotal = 0

        for await (const chunk of streamChatCompletions({
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
          model: endpoint.model,
          messages: messagesForLoop,
          temperature: endpoint.temperature,
          topP: endpoint.topP,
          maxTokens: endpoint.maxTokens,
          reasoningMaxTokens: endpoint.reasoningMaxTokens,
          reasoningEffort,
          showThinking: endpoint.showThinking,
          extraParams: modelExtraParams,
          tools: useXmlToolCompat ? undefined : normalizedTools,
          stream: true,
        })) {
          if (chunk.type === 'thinking' && chunk.text) {
            thinkingText += chunk.text
            await flushEdit(false)
          } else if (chunk.type === 'content' && chunk.text) {
            iterContent += chunk.text
            // 流式展示：displayPrefix（之前轮次累积）+ 本轮当前内容
            if (useXmlToolCompat) {
              const stripped = stripXmlToolCalls(iterContent)
              outputText = [displayPrefix, stripped].filter(s => s.trim()).join('\n\n')
              // 检测到完整 XML 工具调用块 → 立即中断流
              if (xmlToolBlockRe.test(iterContent)) {
                xmlToolDetectedMidStream = true
                app.log.info(
                  { channelId: cfg.channelId, iter },
                  'XML tool call detected mid-stream, aborting stream to execute tool'
                )
                break
              }
            } else {
              outputText = [displayPrefix, iterContent].filter(s => s.trim()).join('\n\n')
            }
            await flushEdit(false)
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            // 原生 tool_call delta 累积合并
            const tc = chunk.toolCall as any
            const idx = Number(tc.index ?? 0)
            if (!nativeToolCallMap.has(idx)) {
              nativeToolCallMap.set(idx, {
                id: String(tc.id ?? ''),
                name: String(tc.function?.name ?? ''),
                arguments: String(tc.function?.arguments ?? ''),
              })
            } else {
              const existing = nativeToolCallMap.get(idx)!
              if (tc.id) existing.id = String(tc.id)
              if (tc.function?.name) existing.name += String(tc.function.name)
              if (tc.function?.arguments) existing.arguments += String(tc.function.arguments)
            }
          } else if (chunk.type === 'done' && chunk.usage) {
            // 同一轮流式请求内：覆盖（上游可能多次上报累计值）
            iterUsageInput = chunk.usage.inputTokens
            iterUsageOutput = chunk.usage.outputTokens
            iterUsageTotal = chunk.usage.totalTokens
          }
        }

        // ── 本轮 usage 累加到全局（跨轮相加）──
        usageInput += iterUsageInput
        usageOutput += iterUsageOutput
        usageTotal += iterUsageTotal

        // 记录第一轮的 input token 数（用于总结阈值判断，不含工具调用膨胀）
        if (modelIterations === 1) {
          firstIterUsageInput = iterUsageInput
        }

        // ── 流结束，检查是否有工具调用 ──
        if (!hasTools) {
          // 无工具模式，单轮完成
          gotFinalResponse = true
          break
        }

        // 原生 tool_calls 从 delta 合并结果中构建
        const assistantToolCalls: import('./llm.js').OpenAIToolCall[] = Array.from(nativeToolCallMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([, tc]) => ({
            id: tc.id || undefined,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          }))
          .filter((tc) => tc.function.name.length > 0)

        const xmlToolCalls = useXmlToolCompat ? parseXmlToolCalls(iterContent) : []
        const assistantContent = useXmlToolCompat
          ? stripXmlToolCalls(iterContent)
          : iterContent

        const hasNativeToolCalls = assistantToolCalls.length > 0
        const hasXmlToolCalls = xmlToolCalls.length > 0

        // 构建 assistant message 加入上下文
        const assistantMessageForModel: OpenAIMessage = {
          role: 'assistant',
          content: assistantContent,
          ...(hasNativeToolCalls ? { tool_calls: assistantToolCalls } : {}),
        }
        messagesForLoop.push(assistantMessageForModel)

        if (!hasNativeToolCalls && !hasXmlToolCalls) {
          outputText = [displayPrefix, assistantContent].filter(s => s.trim()).join('\n\n')
          gotFinalResponse = true
          break
        }

        // XML 模式：清洗 outputText（剥离工具调用后的正文）
        if (useXmlToolCompat) {
          outputText = [displayPrefix, assistantContent].filter(s => s.trim()).join('\n\n')
        }

        // ── 收集本轮工具调用摘要（用于 Discord 展示） ──
        const toolSummaries: string[] = []

        // ── 执行原生工具调用 ──
        if (hasNativeToolCalls) {
          toolCallCount += assistantToolCalls.length

          for (let tcIndex = 0; tcIndex < assistantToolCalls.length; tcIndex++) {
            const tc = assistantToolCalls[tcIndex]
            const toolCallId =
              (typeof tc.id === 'string' && tc.id.trim()) || `call_${iter}_${tcIndex}`
            const toolName =
              typeof tc.function?.name === 'string' ? tc.function.name.trim() : ''
            const toolArgs = safeParseJsonObject(tc.function?.arguments ?? '{}')

            // 生成用户可读的工具调用摘要
            toolSummaries.push(`-# 🔧 调用工具: ${toolName || 'unknown'} 输入内容: ${tc.function?.arguments ?? '{}'}`)

            let toolResult = ''
            if (!toolName) {
              toolResult = '工具调用失败：工具名为空'
            } else if (!mcpManager.hasTool(toolName)) {
              toolResult = `工具调用失败：未注册工具 ${toolName}`
            } else {
              try {
                toolResult = await mcpManager.callTool(toolName, toolArgs)
              } catch (toolError) {
                const msg = toolError instanceof Error ? toolError.message : String(toolError)
                toolResult = `工具调用失败：${msg}`
              }
            }

            messagesForLoop.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: toolResult || '工具返回空结果',
            })
          }
        }

        // ── 执行 XML 工具调用 ──
        if (hasXmlToolCalls) {
          toolCallCount += xmlToolCalls.length
          const resultBlocks: string[] = []

          for (const tc of xmlToolCalls) {
            const toolName = String(tc.name ?? '').trim()
            const toolArgs = tc.arguments ?? {}

            // 生成用户可读的工具调用摘要
            toolSummaries.push(`-# 🔧 调用工具: ${toolName || 'unknown'} 输入内容: ${JSON.stringify(toolArgs)}`)

            let toolResult = ''
            if (!toolName) {
              toolResult = '工具调用失败：工具名为空'
            } else if (!mcpManager.hasTool(toolName)) {
              toolResult = `工具调用失败：未注册工具 ${toolName}`
            } else {
              try {
                toolResult = await mcpManager.callTool(toolName, toolArgs)
              } catch (toolError) {
                const msg = toolError instanceof Error ? toolError.message : String(toolError)
                toolResult = `工具调用失败：${msg}`
              }
            }

            resultBlocks.push(`[${toolName || 'unknown'}]\n${toolResult || '工具返回空结果'}`)
          }

          messagesForLoop.push({
            role: 'user',
            content: `【工具调用结果】\n\n${resultBlocks.join('\n\n')}\n\n请基于以上工具结果继续回答。`,
          })
        }

        // 更新 displayPrefix：累积本轮正文 + 工具调用摘要（用于下一轮展示）
        const cleanIterText = useXmlToolCompat ? assistantContent : iterContent
        const parts: string[] = [displayPrefix, cleanIterText].filter(s => s.trim())
        if (toolSummaries.length > 0) {
          parts.push(toolSummaries.join('\n'))
        }
        displayPrefix = parts.join('\n')
        outputText = displayPrefix
      }

      if (!gotFinalResponse && !outputText.trim()) {
        outputText = `⚠️ 已达到最大工具调用轮次（${maxIterations}），仍未获得最终回复。`
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    app.log.error({ err: error, channelId: cfg.channelId }, 'stream reply failed')
    // 给用户展示简洁的错误原因
    const shortReason = errMsg.length > 200 ? errMsg.slice(0, 200) + '...' : errMsg
    outputText = outputText.trim()
      ? `${outputText}\n\n⚠️ 流式传输中断: ${shortReason}`
      : `⚠️ 回复失败: ${shortReason}`
  }

  if (!outputText.trim()) {
    outputText = '（模型未返回正文）'
  }

  if (usageInput <= 0) usageInput = estimatedInputTokens
  if (usageOutput <= 0) usageOutput = estimateTokens(outputText)
  if (usageTotal <= 0) usageTotal = usageInput + usageOutput

  const iterations = Math.max(1, modelIterations || toolCallCount + 1)
  const footer = formatReplyMetaLine({
    elapsedMs: Date.now() - startedAtMs,
    inputTokens: usageInput,
    outputTokens: usageOutput,
    iterations,
  })

  // ⭐ 剥离所有 -# Time:... 行（无论来源），确保只有最终真正的 footer
  outputText = stripMetaFooter(outputText)

  // ⭐ 最终 Discord 展示文本经过正则处理，再次确保无残留 footer
  const displayOutput = stripMetaFooter(applyDisplayRegex(outputText))
  const finalBodyParts: string[] = []
  if (endpoint.showThinking && thinkingText.trim()) {
    finalBodyParts.push('**思考完成**')
  }
  if (displayOutput.trim()) {
    finalBodyParts.push(displayOutput)
  }
  const finalBody = finalBodyParts.join('\n\n').trim() || '（模型未返回正文）'
  const finalContent = clipDiscordContent(`${finalBody}\n\n${footer}`)
  await assistantMessage.edit(finalContent)

  // ⭐ 存入DB时保留原始正文：剥除工具调用摘要行（-# 🔧 ...）和假 footer
  const cleanContent = outputText
    .split('\n')
    .filter(line => !line.startsWith('-# 🔧 '))
    .join('\n')
    .trim()
  // 优先使用上游返回的真实 output token 数，回退到估算值
  const replyTokenCount = usageOutput > 0 ? usageOutput : estimateTokens(cleanContent)
  insertChannelMessage({
    channelId: cfg.channelId,
    messageId: assistantMessage.id,
    authorId: assistantMessage.author.id,
    authorName: assistantMessage.member?.displayName ?? assistantMessage.author.username,
    content: cleanContent,
    role: 'model',
    isBot: true,
    sessionId: cfg.activeSessionId,
    tokenCount: replyTokenCount,
    createdAt: assistantMessage.createdAt.toISOString(),
  })

  // 返回第一轮的 input token 数，用于总结阈值判断（不含工具调用带来的上下文膨胀）
  return firstIterUsageInput > 0 ? firstIterUsageInput : usageInput
}

class DiscordRuntime {
  private client: Client | null = null
  private token: string | null = null
  private startedAt: string | null = null
  private lastError: string | null = null
  private intents: string[] = []

  public isRunning() {
    return !!this.client
  }

  public getStatus() {
    return {
      running: this.isRunning(),
      startedAt: this.startedAt,
      intents: this.intents,
      lastError: this.lastError,
      user: this.client?.user?.tag ?? null,
      guildCount: this.client?.guilds.cache.size ?? 0,
    }
  }

  public async resyncChannelHistory(channelId: string, limit = 200) {
    if (!this.client || !this.client.user) {
      throw new Error('Discord Runtime 未启动')
    }

    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200))
    const channel = await this.client.channels.fetch(channelId).catch(() => null)
    if (!channel || !('messages' in channel)) {
      throw new Error('目标频道不支持消息同步')
    }

    let remaining = safeLimit
    let before: string | undefined
    const collected: any[] = []

    while (remaining > 0) {
      const batchSize = Math.min(100, remaining)
      const page = await (channel as any).messages.fetch({
        limit: batchSize,
        ...(before ? { before } : {}),
      })

      const rows = Array.from(page.values()) as any[]
      if (rows.length === 0) break

      collected.push(...rows)
      remaining -= rows.length
      before = rows[rows.length - 1]?.id

      if (rows.length < batchSize) break
    }

    collected.sort((a, b) => Number(a?.createdTimestamp ?? 0) - Number(b?.createdTimestamp ?? 0))

    const selfId = this.client.user.id
    let insertedCount = 0
    let updatedCount = 0
    let skippedCount = 0

    for (const message of collected) {
      if (!message?.id || !message?.author?.id) {
        skippedCount += 1
        continue
      }

      // 自己的消息仍由 generateChannelReply 负责入库，避免 footer 污染
      if (message.author.id === selfId) {
        skippedCount += 1
        continue
      }

      const role: MessageRole = message.author.bot ? 'bot' : 'user'
      const guildId = message.guildId ?? null
      const channelName = getChannelNameForStore({
        channel: {
          type: message.channel.type,
          isDMBased: () => message.channel.isDMBased(),
          name: 'name' in message.channel ? message.channel.name : null,
        },
      })

      let cfg = getChannelConfig(channelId)
      if (!cfg) {
        cfg = upsertChannelConfig({
          channelId,
          guildId,
          channelName,
          enabled: true,
        })
      } else if (cfg.channelName !== channelName || cfg.guildId !== guildId) {
        cfg = upsertChannelConfig({
          ...cfg,
          channelId,
          guildId,
          channelName,
        })
      }

      const inbound = await buildStoredDiscordMessageContent(message, selfId)
      if (!inbound.content) {
        skippedCount += 1
        continue
      }

      const inserted = insertChannelMessage({
        channelId,
        messageId: message.id,
        authorId: message.author.id,
        authorName: message.member?.displayName ?? message.author.username,
        content: inbound.content,
        role,
        isBot: message.author.bot,
        sessionId: cfg.activeSessionId,
        tokenCount: estimateTokens(inbound.content),
        createdAt: message.createdAt.toISOString(),
      })

      if (inserted) {
        insertedCount += 1
      } else if (updateChannelMessageContent(message.id, inbound.content, estimateTokens(inbound.content))) {
        updatedCount += 1
      } else {
        skippedCount += 1
      }
    }

    return {
      channelId,
      fetchedCount: collected.length,
      insertedCount,
      updatedCount,
      skippedCount,
    }
  }

  /** 构建斜杠命令定义（抽取为独立方法，避免重复） */
  private getSlashCommandDefinitions() {
    return [
      new SlashCommandBuilder()
        .setName('session')
        .setDescription('管理对话会话')
        .addSubcommand((sub) =>
          sub
            .setName('new')
            .setDescription('创建新会话并切换')
            .addStringOption((opt) =>
              opt.setName('name').setDescription('会话名称').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('switch')
            .setDescription('切换到已有会话')
            .addStringOption((opt) =>
              opt.setName('name').setDescription('会话名称').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('列出当前频道的所有会话')
        )
        .addSubcommand((sub) =>
          sub.setName('current').setDescription('查看当前活跃会话')
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('clear')
        .setDescription('清空当前会话的聊天历史')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('summarize')
        .setDescription('立即触发对话总结（无视阈值）')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('查看当前频道的 Bot 配置和状态')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('undo')
        .setDescription('撤销最后一条 Bot 回复（从历史中删除）')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('retry')
        .setDescription('删除最后一条 Bot 回复并重新生成')
        .toJSON(),
      new SlashCommandBuilder()
        .setName('trigger')
        .setDescription('切换触发模式')
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('触发模式')
            .setRequired(true)
            .addChoices(
              { name: 'mention — @提及时回复', value: 'mention' },
              { name: 'all — 所有消息都回复', value: 'all' },
              { name: 'keyword — 关键词触发', value: 'keyword' },
              { name: 'command — !ai 命令触发', value: 'command' },
              { name: 'dm — 仅私信回复', value: 'dm' },
            )
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('model')
        .setDescription('查看或切换当前频道使用的模型端点')
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('列出可用模型端点')
        )
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('按端点 ID 或名称切换模型端点')
            .addStringOption((opt) =>
              opt.setName('value').setDescription('端点 ID 或名称关键词').setRequired(true)
            )
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('preset')
        .setDescription('查看或切换当前频道使用的预设')
        .addSubcommand((sub) =>
          sub.setName('list').setDescription('列出可用预设')
        )
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('按预设 ID 或名称切换预设')
            .addStringOption((opt) =>
              opt.setName('value').setDescription('预设 ID 或名称关键词').setRequired(true)
            )
        )
        .toJSON(),
    ]
  }

  /** 为单个 Guild 注册斜杠命令（即时生效） */
  private async registerSlashCommandsForGuild(guildId: string) {
    if (!this.token || !this.client?.user?.id) return
    const commands = this.getSlashCommandDefinitions()
    const rest = new REST({ version: '10' }).setToken(this.token)
    try {
      await rest.put(
        Routes.applicationGuildCommands(this.client.user.id, guildId),
        { body: commands }
      )
      app.log.info({ guildId }, 'Guild slash commands registered')
    } catch (err) {
      app.log.error({ err, guildId }, 'Failed to register guild slash commands')
    }
  }

  /** 为所有已加入的 Guild 批量注册斜杠命令，并清除残留的全局命令 */
  private async registerSlashCommandsForAllGuilds() {
    if (!this.client || !this.token || !this.client.user?.id) return

    // 先清除全局命令（避免全局 + Guild 双份重复）
    const rest = new REST({ version: '10' }).setToken(this.token)
    try {
      await rest.put(Routes.applicationCommands(this.client.user.id), { body: [] })
      app.log.info('Global slash commands cleared')
    } catch (err) {
      app.log.error({ err }, 'Failed to clear global slash commands')
    }

    const guilds = this.client.guilds.cache
    app.log.info({ guildCount: guilds.size }, 'Registering slash commands for all guilds')
    const promises = guilds.map((guild) => this.registerSlashCommandsForGuild(guild.id))
    await Promise.allSettled(promises)
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction) {
    const channelId = interaction.channelId
    const cmd = interaction.commandName

    // 权限检查：只有 bot 管理员可以操作（通过环境变量 BOT_ADMIN_IDS 配置）
    if (!isBotAdmin(interaction.user.id)) {
      await interaction.reply({ content: '❌ 仅 Bot 管理员可以使用此命令。', ephemeral: true })
      return
    }

    // ─── /session ───
    if (cmd === 'session') {
      const sub = interaction.options.getSubcommand()
      if (sub === 'new' || sub === 'switch') {
        const name = interaction.options.getString('name', true).trim()
        if (!name || name.length > 64) {
          await interaction.reply({ content: '❌ 会话名称需1-64字符', ephemeral: true })
          return
        }
        switchChannelSession(channelId, name)
        const verb = sub === 'new' ? '创建并切换' : '切换'
        await interaction.reply(`✅ 已${verb}到会话「**${name}**」，后续消息将记录到此会话。`)
      } else if (sub === 'list') {
        const sessions = listSessionsForChannel(channelId)
        const cfg = getChannelConfig(channelId)
        const active = cfg?.activeSessionId ?? 'default'
        if (sessions.length === 0) {
          await interaction.reply({ content: '当前频道暂无会话记录。', ephemeral: true })
          return
        }
        const lines = sessions.map(
          (s) =>
            `${s.sessionId === active ? '▶ ' : '  '}**${s.sessionId}** — ${s.messageCount} 条消息${s.lastMessageAt ? ` · 最后活跃 ${s.lastMessageAt.slice(0, 16)}` : ''}`
        )
        await interaction.reply({
          content: `📋 **会话列表**（当前: ${active}）\n${lines.join('\n')}`,
          ephemeral: true,
        })
      } else if (sub === 'current') {
        const cfg = getChannelConfig(channelId)
        await interaction.reply({
          content: `当前活跃会话: **${cfg?.activeSessionId ?? 'default'}**`,
          ephemeral: true,
        })
      }
      return
    }

    // ─── /clear ───
    if (cmd === 'clear') {
      const cfg = getChannelConfig(channelId)
      const sessionId = cfg?.activeSessionId ?? 'default'
      const count = clearChannelSessionHistory(channelId, sessionId)
      await interaction.reply(`🗑️ 已清空会话「**${sessionId}**」的 ${count} 条消息。`)
      return
    }

    // ─── /summarize ───
    if (cmd === 'summarize') {
      const cfg = getChannelConfig(channelId)
      if (!cfg) {
        await interaction.reply({ content: '❌ 频道配置不存在', ephemeral: true })
        return
      }
      await interaction.deferReply()
      try {
        await maybeSummarizeChannel(channelId, cfg, undefined, { force: true })
        const summaries = listChannelSummaries(channelId, cfg.activeSessionId)
        const latest = summaries[0]
        if (latest) {
          const preview = latest.summary.length > 500
            ? latest.summary.slice(0, 500) + '...'
            : latest.summary
          await interaction.editReply(`📝 **总结完成**（${latest.messageCount} 条消息 → ${latest.tokenCount} tokens）\n\n${preview}`)
        } else {
          await interaction.editReply('ℹ️ 没有未总结的消息可供压缩。')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '总结失败'
        await interaction.editReply(`❌ 总结失败: ${msg}`)
      }
      return
    }

    // ─── /status ───
    if (cmd === 'status') {
      const cfg = getChannelConfig(channelId)
      const summaryCfg = getSummaryConfig()
      const endpoint = cfg ? resolveEndpointForChannel(cfg) : null
      const sessions = listSessionsForChannel(channelId)
      const unsummarized = cfg
        ? listUnsummarizedMessages(channelId, 9999, cfg.activeSessionId)
        : []
      const unsumTokens = unsummarized.reduce((acc, m) => acc + (m.tokenCount || 0), 0)
      const summaries = listChannelSummaries(channelId, cfg?.activeSessionId)

      const lines = [
        `📊 **频道状态**`,
        `频道: ${cfg?.channelName || channelId}`,
        `启用: ${cfg?.enabled ? '✅' : '❌'}`,
        `触发模式: \`${cfg?.triggerMode ?? 'mention'}\``,
        `活跃会话: \`${cfg?.activeSessionId ?? 'default'}\` (共 ${sessions.length} 个)`,
        `模型: \`${endpoint?.model ?? '未配置'}\``,
        `端点: ${endpoint?.name ?? '未配置'}`,
        `未总结消息: ${unsummarized.length} 条 / ${unsumTokens} tokens`,
        `总结阈值(全局): ${summaryCfg.summaryThreshold} tokens`,
        `已有总结: ${summaries.length} 条`,
        `沉默阈值: ${cfg?.silenceThreshold ?? 180} 分钟`,
      ]
      await interaction.reply({ content: lines.join('\n'), ephemeral: true })
      return
    }

    // ─── /model ───
    if (cmd === 'model') {
      const sub = interaction.options.getSubcommand()
      const endpoints = listEndpoints()

      if (sub === 'list') {
        if (endpoints.length === 0) {
          await interaction.reply({ content: '当前没有可用模型端点。', ephemeral: true })
          return
        }

        const cfg = getChannelConfig(channelId)
        const explicitId = cfg?.endpointId ?? null
        const resolved = cfg ? resolveEndpointForChannel(cfg) : null

        const lines = endpoints.slice(0, 50).map((ep) => {
          const selected = explicitId
            ? ep.id === explicitId
            : resolved
              ? ep.id === resolved.id
              : false
          return `${selected ? '▶' : '  '} \`${ep.id}\` · ${ep.name} · model=\`${ep.model}\``
        })

        await interaction.reply({
          content: [
            '🧠 **模型端点列表**（当前频道）',
            `当前: ${resolved ? `**${resolved.name}** (\`${resolved.id}\`)` : '未配置'}`,
            ...lines,
          ].join('\n'),
          ephemeral: true,
        })
        return
      }

      if (sub === 'set') {
        if (endpoints.length === 0) {
          await interaction.reply({ content: '❌ 当前没有可用模型端点。', ephemeral: true })
          return
        }

        const keyword = interaction.options.getString('value', true).trim()
        const kw = keyword.toLowerCase()

        let target =
          endpoints.find((x) => x.id.toLowerCase() === kw) ??
          endpoints.find((x) => x.name.toLowerCase() === kw) ??
          null

        if (!target) {
          const partial = endpoints.filter(
            (x) => x.id.toLowerCase().includes(kw) || x.name.toLowerCase().includes(kw)
          )
          if (partial.length === 1) {
            target = partial[0]
          } else if (partial.length > 1) {
            await interaction.reply({
              content: `⚠️ 命中过多，请输入更精确值：\n${partial
                .slice(0, 8)
                .map((x) => `- \`${x.id}\` · ${x.name}`)
                .join('\n')}`,
              ephemeral: true,
            })
            return
          }
        }

        if (!target) {
          await interaction.reply({ content: `❌ 未找到模型端点：${keyword}`, ephemeral: true })
          return
        }

        // 查找绑定到此端点的预设
        const boundPreset = resolvePresetForEndpoint(target.id)

        // 同时更新端点 ID 和预设 ID（如果找到绑定预设）
        const updateData: { channelId: string; endpointId: string; presetId?: string | null } = {
          channelId,
          endpointId: target.id,
        }
        if (boundPreset) {
          updateData.presetId = boundPreset.id
        }

        upsertChannelConfig(updateData)

        let replyText = `✅ 已切换模型端点：**${target.name}** (\`${target.id}\`) · model=\`${target.model}\``
        if (boundPreset) {
          replyText += `\n🔄 自动切换到绑定的预设：**${boundPreset.name}** (\`${boundPreset.id}\`)`
        } else {
          replyText += '\nℹ️ 该端点未绑定预设，当前预设保持不变。'
        }

        await interaction.reply(replyText)
        return
      }
    }

    // ─── /preset ───
    if (cmd === 'preset') {
      const sub = interaction.options.getSubcommand()
      const presets = listPresets()

      if (sub === 'list') {
        if (presets.length === 0) {
          await interaction.reply({ content: '当前没有可用预设。', ephemeral: true })
          return
        }

        const cfg = getChannelConfig(channelId)
        const currentPresetId = cfg?.presetId ?? null
        const lines = presets
          .slice(0, 80)
          .map((p) => `${currentPresetId === p.id ? '▶' : '  '} \`${p.id}\` · ${p.name}`)

        await interaction.reply({
          content: [
            '🧩 **预设列表**（当前频道）',
            `当前: ${currentPresetId ? `\`${currentPresetId}\`` : '未配置'}`,
            ...lines,
          ].join('\n'),
          ephemeral: true,
        })
        return
      }

      if (sub === 'set') {
        if (presets.length === 0) {
          await interaction.reply({ content: '❌ 当前没有可用预设。', ephemeral: true })
          return
        }

        const keyword = interaction.options.getString('value', true).trim()
        const kw = keyword.toLowerCase()

        let target =
          presets.find((x) => x.id.toLowerCase() === kw) ??
          presets.find((x) => x.name.toLowerCase() === kw) ??
          null

        if (!target) {
          const partial = presets.filter(
            (x) => x.id.toLowerCase().includes(kw) || x.name.toLowerCase().includes(kw)
          )
          if (partial.length === 1) {
            target = partial[0]
          } else if (partial.length > 1) {
            await interaction.reply({
              content: `⚠️ 命中过多，请输入更精确值：\n${partial
                .slice(0, 8)
                .map((x) => `- \`${x.id}\` · ${x.name}`)
                .join('\n')}`,
              ephemeral: true,
            })
            return
          }
        }

        if (!target) {
          await interaction.reply({ content: `❌ 未找到预设：${keyword}`, ephemeral: true })
          return
        }

        upsertChannelConfig({ channelId, presetId: target.id })
        await interaction.reply(`✅ 已切换预设：**${target.name}** (\`${target.id}\`)`)
        return
      }
    }

    // ─── /undo ───
    if (cmd === 'undo') {
      const cfg = getChannelConfig(channelId)
      const sessionId = cfg?.activeSessionId ?? 'default'
      const messages = listChannelMessages(channelId, 500, sessionId)
      // 找最后一条 model/bot 消息
      let lastBotMsg = null
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'model' || messages[i].role === 'bot') {
          lastBotMsg = messages[i]
          break
        }
      }
      if (!lastBotMsg) {
        await interaction.reply({ content: 'ℹ️ 没有找到可撤销的 Bot 回复。', ephemeral: true })
        return
      }
      // 从 DB 删除
      deleteChannelMessagesByIds([lastBotMsg.id])
      // 从 Discord 频道也撤回
      try {
        const channel = interaction.channel
        if (channel && 'messages' in channel) {
          const discordMsg = await channel.messages.fetch(lastBotMsg.messageId).catch(() => null)
          if (discordMsg?.deletable) {
            await discordMsg.delete()
          }
        }
      } catch {
        // Discord 删除失败不影响流程（可能消息已被删除/权限不足）
      }
      await interaction.reply('↩️ 已撤销最后一条回复。')
      return
    }

    // ─── /retry ───
    if (cmd === 'retry') {
      const cfg = getChannelConfig(channelId)
      if (!cfg) {
        await interaction.reply({ content: '❌ 频道配置不存在', ephemeral: true })
        return
      }

      const sessionId = cfg.activeSessionId ?? 'default'
      const messages = listChannelMessages(channelId, 500, sessionId)

      // 找最后一条 model/bot 消息并删除
      let lastBotMsg = null
      let lastBotIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'model' || messages[i].role === 'bot') {
          lastBotMsg = messages[i]
          lastBotIndex = i
          break
        }
      }

      if (!lastBotMsg) {
        await interaction.reply({ content: 'ℹ️ 没有找到可重试的 Bot 回复。', ephemeral: true })
        return
      }

      deleteChannelMessagesByIds([lastBotMsg.id])
      // 从 Discord 频道也撤回
      try {
        const channel = interaction.channel
        if (channel && 'messages' in channel) {
          const discordMsg = await fetchChannelMessageById(channel, lastBotMsg.messageId)
          if (discordMsg?.deletable) {
            await discordMsg.delete()
          }
        }
      } catch {
        // 忽略
      }

      await interaction.deferReply({ ephemeral: true })
      try {
        const channel = interaction.channel
        if (!channel || !('messages' in channel)) {
          throw new Error('当前频道不支持重试')
        }

        // 仅复用“被重试回复之前”的用户消息作为触发源
        let triggerMessage: any | null = null
        if (lastBotIndex >= 0) {
          for (let i = lastBotIndex - 1; i >= 0; i--) {
            const row = messages[i]
            if (row.role !== 'user') continue
            triggerMessage = await fetchChannelMessageById(channel, row.messageId)
            if (triggerMessage) break
          }
        }

        if (!triggerMessage) {
          throw new Error('找不到被重试回复之前的用户消息记录')
        }

        const knownInputTokens = await generateChannelReply(triggerMessage, cfg)
        await maybeSummarizeChannel(channelId, cfg, knownInputTokens)
        await interaction.editReply('✅ 已重新生成。')
      } catch (err) {
        const msg = err instanceof Error ? err.message : '重试失败'
        await interaction.editReply(`❌ 重新生成失败: ${msg}`)
      }
      return
    }

    // ─── /trigger ───
    if (cmd === 'trigger') {
      const mode = interaction.options.getString('mode', true) as ChannelConfigRecord['triggerMode']
      upsertChannelConfig({ channelId, triggerMode: mode })
      const modeLabels: Record<string, string> = {
        mention: '@提及时回复',
        all: '所有消息都回复',
        keyword: '关键词触发',
        command: '!ai 命令触发',
        dm: '仅私信回复',
      }
      await interaction.reply(`⚡ 触发模式已切换为: **${modeLabels[mode] ?? mode}**`)
      return
    }
  }

  public async start(token: string, intentNames: string[]) {
    await this.stop()

    const intentInfo = resolveIntentBits(intentNames)
    if (intentInfo.unknown.length > 0) {
      throw new Error(`存在未知 intents: ${intentInfo.unknown.join(', ')}`)
    }

    const client = new Client({
      intents: intentInfo.bits,
      partials: [Partials.Channel, Partials.Message, Partials.User],
    })

    // 注册斜杠命令交互处理
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return
      try {
        await this.handleSlashCommand(interaction)
      } catch (err) {
        app.log.error({ err }, 'slash command failed')
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ 命令执行失败', ephemeral: true }).catch(() => {})
        } else {
          await interaction.reply({ content: '❌ 命令执行失败', ephemeral: true }).catch(() => {})
        }
      }
    })

    // 新服务器加入时自动注册斜杠命令
    client.on(Events.GuildCreate, async (guild) => {
      app.log.info({ guildId: guild.id, guildName: guild.name }, 'Joined new guild')
      await this.registerSlashCommandsForGuild(guild.id)
    })

    client.on(Events.MessageCreate, async (message) => {
      try {
        const selfId = client.user?.id ?? ''
        // ⭐ 区分自己的bot（role='model'）、其他bot（role='bot'）、用户（role='user'）
        const role: MessageRole = message.author.id === selfId
          ? 'model'
          : message.author.bot
            ? 'bot'
            : 'user'
        const channelId = message.channelId
        const guildId = message.guildId ?? null
        const channelName = getChannelNameForStore({
          channel: {
            type: message.channel.type,
            isDMBased: () => message.channel.isDMBased(),
            name: 'name' in message.channel ? message.channel.name : null,
          },
        })

        let cfg = getChannelConfig(channelId)

        // 确保频道配置存在（默认启用）
        if (!cfg) {
          cfg = upsertChannelConfig({
            channelId,
            guildId,
            channelName,
            enabled: true,
          })
        } else if (cfg.channelName !== channelName || cfg.guildId !== guildId) {
          cfg = upsertChannelConfig({
            ...cfg,
            channelId,
            guildId,
            channelName,
          })
        }

        // ⭐ 自己的回复由 generateChannelReply 存储（已剥离footer），这里跳过
        if (message.author.id === selfId) return

        // 解析消息正文：处理 mention、附件、引用消息（文字/图片）
        const inbound = await buildStoredDiscordMessageContent(message, selfId)
        if (!inbound.content) return

        insertChannelMessage({
          channelId,
          messageId: message.id,
          authorId: message.author.id,
          authorName: message.member?.displayName ?? message.author.username,
          content: inbound.content,
          role,
          isBot: message.author.bot,
          sessionId: cfg.activeSessionId,
          tokenCount: estimateTokens(inbound.content),
          createdAt: message.createdAt.toISOString(),
        })

        if (message.author.bot) return
        if (!cfg.enabled) return

        const shouldReply = shouldTriggerReply(message, cfg, client.user?.id ?? null)
        let knownInputTokens: number | undefined
        if (shouldReply) {
          knownInputTokens = await generateChannelReply(message, cfg)
        }

        await maybeSummarizeChannel(channelId, cfg, knownInputTokens)
      } catch (error) {
        app.log.error({ err: error }, 'failed to handle messageCreate')
      }
    })

    client.on(Events.MessageUpdate, async (_oldMessage, newMessage) => {
      try {
        if (newMessage.partial) {
          try {
            await newMessage.fetch()
          } catch {
            return
          }
        }

        // 跳过自己的消息编辑（bot 回复由 generateChannelReply 存储，避免 footer 污染 DB）
        if (newMessage.author?.id === client.user?.id) return

        const inbound = await buildStoredDiscordMessageContent(newMessage, client.user?.id ?? null)
        updateChannelMessageContent(newMessage.id, inbound.content, estimateTokens(inbound.content))
      } catch (error) {
        app.log.error({ err: error }, 'failed to handle messageUpdate')
      }
    })

    client.on(Events.MessageDelete, async (message) => {
      try {
        const messageId = String(message?.id ?? '').trim()
        if (!messageId) return
        deleteChannelMessageByMessageId(messageId)
      } catch (error) {
        app.log.error({ err: error }, 'failed to handle messageDelete')
      }
    })

    client.on(Events.MessageBulkDelete, async (messages) => {
      try {
        const messageIds = Array.from(messages.keys())
        if (messageIds.length === 0) return
        deleteChannelMessagesByMessageIds(messageIds)
      } catch (error) {
        app.log.error({ err: error }, 'failed to handle messageBulkDelete')
      }
    })

    await client.login(token)
    const readyInfo = await waitForClientReady(client, 15000)

    this.client = client
    this.token = token
    this.startedAt = nowIso()
    this.lastError = null
    this.intents = intentNames

    // 为所有已加入的 Guild 注册斜杠命令（阻塞等待完成，确保命令可用）
    try {
      await this.registerSlashCommandsForAllGuilds()
    } catch (err) {
      app.log.error({ err }, 'Failed to register guild slash commands')
    }

    return readyInfo
  }

  public async stop() {
    if (this.client) {
      this.client.destroy()
      this.client = null
    }
    this.token = null
    this.startedAt = null
  }

  public setError(msg: string) {
    this.lastError = msg
  }
}

const discordRuntime = new DiscordRuntime()

app.register(cors, { origin: true, credentials: true })
app.register(websocket)

// 初始化 DB
getDb()

app.get('/api/status', async () => {
  return {
    ok: true,
    data: {
      name: 'graywill-discord-bot',
      uptime: process.uptime(),
      now: nowIso(),
      discord: discordRuntime.getStatus(),
    },
  }
})

app.get('/api/dashboard', async (request, reply) => {
  try {
    const { eventLimit, timeZone } = request.query as {
      eventLimit?: string
      timeZone?: string
    }

    const tz = normalizeTimeZone(timeZone)
    const parsedLimit = Number(eventLimit ?? 20)
    const limit = Number.isFinite(parsedLimit) ? Math.max(5, Math.min(100, parsedLimit)) : 20
    const sinceIso = getStartOfTodayIsoByTimeZone(tz)

    const db = getDb()

    const todayAgg = db
      .prepare(
        `
        SELECT
          COUNT(*) AS message_count,
          COALESCE(SUM(token_count), 0) AS token_sum,
          COUNT(DISTINCT channel_id) AS active_channels
        FROM channel_messages
        WHERE created_at >= ?
      `
      )
      .get(sinceIso) as any

    const channelNameMap = new Map<string, string>()
    for (const c of listChannelConfigs()) {
      channelNameMap.set(c.channelId, c.channelName || c.channelId)
    }

    const messageEvents = db
      .prepare(
        `
        SELECT channel_id, role, author_name, content, created_at
        FROM channel_messages
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
      .all(limit) as any[]

    const summaryEvents = db
      .prepare(
        `
        SELECT channel_id, message_count, token_count, created_at
        FROM channel_summaries
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
      .all(limit) as any[]

    const events: Array<{
      createdAt: string
      level: DashboardEventLevel
      event: string
    }> = []

    for (const row of messageEvents) {
      const channelId = String(row.channel_id ?? '')
      const channelName = channelNameMap.get(channelId) || channelId || 'unknown'
      const role = String(row.role ?? 'user')
      const author = String(row.author_name ?? 'unknown')
      const content = String(row.content ?? '')
      const preview = content.length > 60 ? `${content.slice(0, 60)}...` : content

      if (role === 'bot' || role === 'model') {
        events.push({
          createdAt: String(row.created_at),
          level: 'success',
          event: `频道 ${channelName} 生成回复：${preview}`,
        })
      } else {
        events.push({
          createdAt: String(row.created_at),
          level: 'info',
          event: `频道 ${channelName} 收到消息（${author}）：${preview}`,
        })
      }
    }

    for (const row of summaryEvents) {
      const channelId = String(row.channel_id ?? '')
      const channelName = channelNameMap.get(channelId) || channelId || 'unknown'
      const count = Number(row.message_count ?? 0)
      const tokens = Number(row.token_count ?? 0)

      events.push({
        createdAt: String(row.created_at),
        level: 'warning',
        event: `频道 ${channelName} 触发总结压缩：${count} 条 / ${tokens} tokens`,
      })
    }

    const mergedEvents = events
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map((x) => ({
        time: formatTimeInTimeZone(x.createdAt, tz),
        event: x.event,
        level: x.level,
        createdAt: x.createdAt,
      }))

    return {
      ok: true,
      data: {
        botStatus: discordRuntime.getStatus().running ? '在线' : '离线',
        activeChannels: Number(todayAgg?.active_channels ?? 0),
        todayMessages: Number(todayAgg?.message_count ?? 0),
        tokenThroughput: Number(todayAgg?.token_sum ?? 0),
        events: mergedEvents,
        timeZone: tz,
        since: sinceIso,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '读取仪表盘失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

// ---------------- Discord 验证面板接口 ----------------

app.post('/api/discord/verify', async (request, reply) => {
  try {
    const input = verifySchema.parse(request.body)
    const intents = resolveIntentBits(input.intents)
    const me = await verifyBotToken(input.token)

    return {
      ok: true,
      message: 'Token 验证成功',
      data: {
        botUser: `${me.username} (${me.id})`,
        intents: input.intents,
        unknownIntents: intents.unknown,
        intentBitfield: intents.bitfield,
        permissions: input.permissions,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '验证失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/discord/ping', async (request, reply) => {
  let client: Client | null = null

  try {
    const input = pingSchema.parse(request.body)
    const intents = resolveIntentBits(input.intents)

    if (intents.unknown.length > 0) {
      reply.code(400)
      return { ok: false, message: `存在未知 intents: ${intents.unknown.join(', ')}` }
    }

    client = new Client({
      intents: intents.bits,
      partials: [Partials.Channel, Partials.Message, Partials.User],
    })

    await client.login(input.token)
    const info = await waitForClientReady(client, 12000)

    return {
      ok: true,
      message: 'Gateway 连通性验证成功',
      data: {
        botUser: info.userTag,
        guildCount: info.guildCount,
        intents: input.intents,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '网关验证失败'
    reply.code(400)
    return { ok: false, message: msg }
  } finally {
    if (client) client.destroy()
  }
})

app.get('/api/discord/runtime', async () => ({
  ok: true,
  data: discordRuntime.getStatus(),
}))

app.post('/api/discord/start', async (request, reply) => {
  try {
    const input = discordStartSchema.parse(request.body)
    const info = await discordRuntime.start(input.token, input.intents)
    return {
      ok: true,
      message: 'Discord Runtime 启动成功',
      data: { ...info, intents: input.intents },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '启动失败'
    discordRuntime.setError(msg)
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/discord/stop', async () => {
  await discordRuntime.stop()
  return { ok: true, message: 'Discord Runtime 已停止' }
})

// ---------------- 频道配置 API ----------------

app.get('/api/channels', async () => {
  return { ok: true, data: listChannelConfigs() }
})

app.get('/api/summary-config', async () => {
  return { ok: true, data: getSummaryConfig() }
})

app.put('/api/summary-config', async (request, reply) => {
  try {
    const body = summaryConfigUpsertSchema.parse(request.body)
    const row = upsertSummaryConfig(body)
    return { ok: true, data: row }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新总结配置失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.get('/api/channels/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const row = getChannelConfig(id)
  if (!row) {
    reply.code(404)
    return { ok: false, message: '频道配置不存在' }
  }
  return { ok: true, data: row }
})

app.put('/api/channels/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string }
    const body = channelUpsertSchema.parse(request.body)
    const row = upsertChannelConfig({
      channelId: id,
      ...body,
    })
    return { ok: true, data: row }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新频道失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/channels/batch-apply', async (request, reply) => {
  try {
    const body = channelBatchApplySchema.parse(request.body)
    const source = getChannelConfig(body.sourceChannelId)
    if (!source) {
      reply.code(404)
      return { ok: false, message: '源频道配置不存在' }
    }

    const targetIds = Array.from(
      new Set(
        body.targetChannelIds
          .map((x) => x.trim())
          .filter(Boolean)
      )
    ).filter((id) => id !== source.channelId)

    const appliedChannelIds: string[] = []

    for (const channelId of targetIds) {
      const prev = getChannelConfig(channelId)
      const next = upsertChannelConfig({
        channelId,
        enabled: body.includeEnabled ? source.enabled : (prev?.enabled ?? true),
        endpointId: source.endpointId,
        presetId: source.presetId,
        characterId: source.characterId,
        triggerMode: source.triggerMode,
        summaryThreshold: source.summaryThreshold,
        maxHistoryTokens: source.maxHistoryTokens,
        historyMessageLimit: source.historyMessageLimit,
        timeZone: source.timeZone,
        silenceThreshold: source.silenceThreshold,
        toolsEnabled: source.toolsEnabled,
        maxToolIterations: source.maxToolIterations,
        historyInsertAt: source.historyInsertAt,
        assistantPrefill: source.assistantPrefill,
        worldbookInlineJson: source.worldbookInlineJson,
        customMacrosJson: source.customMacrosJson,
        userDisplayName: source.userDisplayName,
        summarySystemPrompt: source.summarySystemPrompt,
        summaryUserPrompt: source.summaryUserPrompt,
        summaryEndpointId: source.summaryEndpointId,
        summaryTemperature: source.summaryTemperature,
        summaryMaxTokens: source.summaryMaxTokens,
        // 会话选择保持目标频道自身状态，不跟随源频道复制
        activeSessionId: prev?.activeSessionId ?? 'default',
      })
      appliedChannelIds.push(next.channelId)
    }

    return {
      ok: true,
      data: {
        sourceChannelId: source.channelId,
        appliedCount: appliedChannelIds.length,
        appliedChannelIds,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '批量应用频道配置失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

// ---------------- 模型端点 / 预设 / 角色 API ----------------

app.get('/api/endpoints', async () => ({ ok: true, data: listEndpoints() }))

app.post('/api/endpoints', async (request, reply) => {
  try {
    const body = endpointSchema.parse(request.body)
    upsertEndpoint(body)
    return { ok: true, message: '端点已保存' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存端点失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/endpoints/:id/copy', async (request, reply) => {
  try {
    const { id } = request.params as { id: string }
    const endpoints = listEndpoints()
    const source = endpoints.find((x) => x.id === id)

    if (!source) {
      reply.code(404)
      return { ok: false, message: '源端点不存在' }
    }

    const existingIds = new Set(endpoints.map((x) => x.id))
    const existingNames = new Set(endpoints.map((x) => x.name))

    const copiedId = buildCopiedEndpointId(source.id, existingIds)
    const copiedName = buildCopiedEndpointName(source.name, existingNames)

    upsertEndpoint({
      id: copiedId,
      name: copiedName,
      baseUrl: source.baseUrl,
      apiKey: source.apiKey,
      model: source.model,
      maxTokens: source.maxTokens,
      temperature: source.temperature,
      topP: source.topP,
      extraParams: source.extraParams,
      reasoningMaxTokens: source.reasoningMaxTokens,
      reasoningEffort: source.reasoningEffort,
      showThinking: source.showThinking,
    })

    const copied = listEndpoints().find((x) => x.id === copiedId)
    return {
      ok: true,
      message: '端点已复制',
      data: copied ?? {
        ...source,
        id: copiedId,
        name: copiedName,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '复制端点失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.delete('/api/endpoints/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const ok = deleteEndpoint(id)
  if (!ok) {
    reply.code(404)
    return { ok: false, message: '端点不存在' }
  }
  return { ok: true, message: '端点已删除' }
})

app.get('/api/presets', async () => ({ ok: true, data: listPresets() }))

app.post('/api/presets', async (request, reply) => {
  try {
    const body = presetSchema.parse(request.body)
    upsertPreset({
      ...body,
      updatedAt: nowIso(),
    })
    return { ok: true, message: '预设已保存' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存预设失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/presets/:id/copy', async (request, reply) => {
  try {
    const { id } = request.params as { id: string }
    const presets = listPresets()
    const source = presets.find((x) => x.id === id)

    if (!source) {
      reply.code(404)
      return { ok: false, message: '源预设不存在' }
    }

    const existingIds = new Set(presets.map((x) => x.id))
    const existingNames = new Set(presets.map((x) => x.name))

    const copiedId = buildCopiedPresetId(source.id, existingIds)
    const copiedName = buildCopiedPresetName(source.name, existingNames)

    const copiedPreset = {
      id: copiedId,
      name: copiedName,
      data: source.data,
      updatedAt: nowIso(),
    }

    upsertPreset(copiedPreset)
    const copied = listPresets().find((x) => x.id === copiedId)

    return {
      ok: true,
      message: '预设已复制',
      data: copied ?? copiedPreset,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '复制预设失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.delete('/api/presets/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const ok = deletePreset(id)
  if (!ok) {
    reply.code(404)
    return { ok: false, message: '预设不存在' }
  }
  return { ok: true, message: '预设已删除' }
})

app.get('/api/characters', async () => ({ ok: true, data: listCharacters() }))

app.post('/api/characters', async (request, reply) => {
  try {
    const body = characterSchema.parse(request.body)
    upsertCharacter({
      ...body,
      updatedAt: nowIso(),
    })
    return { ok: true, message: '角色卡已保存' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存角色卡失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.delete('/api/characters/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const ok = deleteCharacter(id)
  if (!ok) {
    reply.code(404)
    return { ok: false, message: '角色卡不存在' }
  }
  return { ok: true, message: '角色卡已删除' }
})

// ---------------- 历史 / 总结 API ----------------

app.get('/api/history/:channelId', async (request) => {
  const { channelId } = request.params as { channelId: string }
  const { limit, sessionId } = request.query as { limit?: string; sessionId?: string }
  const n = limit === undefined ? 500 : normalizeHistoryLimit(limit, 500)
  return {
    ok: true,
    data: {
      channelId,
      messages: listChannelMessages(channelId, n, sessionId || undefined),
      unsummarized: listUnsummarizedMessages(channelId, n, sessionId || undefined),
    },
  }
})

app.post('/api/history/:channelId/resync', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const body = historyResyncSchema.parse(request.body ?? {})
    const stats = await discordRuntime.resyncChannelHistory(channelId, body.limit ?? 200)
    return { ok: true, data: stats }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '重建历史失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.get('/api/history/:channelId/formatted', async (request) => {
  const { channelId } = request.params as { channelId: string }
  const {
    limit,
    timeZone,
    silenceThresholdMinutes,
    useUnsummarized,
    sessionId,
  } = request.query as {
    limit?: string
    timeZone?: string
    silenceThresholdMinutes?: string
    useUnsummarized?: string
    sessionId?: string
  }

  const n = limit === undefined ? 500 : normalizeHistoryLimit(limit, 500)
  const threshold = silenceThresholdMinutes
    ? Math.max(1, Math.min(24 * 60, Number(silenceThresholdMinutes)))
    : 180

  const source =
    useUnsummarized === '0'
      ? listChannelMessages(channelId, n, sessionId || undefined)
      : listUnsummarizedMessages(channelId, n, sessionId || undefined)

  const formatted = buildPromptHistoryBlock(source, {
    timeZone: timeZone || 'Asia/Shanghai',
    silenceThresholdMinutes: threshold,
  })

  return {
    ok: true,
    data: {
      channelId,
      count: source.length,
      rows: formatted.rows,
      grouped: formatted.grouped,
      mergedUserContent: formatted.mergedUserContent,
      openaiHistory: formatted.openaiHistory,
    },
  }
})

app.get('/api/summaries/:channelId', async (request) => {
  const { channelId } = request.params as { channelId: string }
  const { sessionId } = request.query as { sessionId?: string }
  return {
    ok: true,
    data: listChannelSummaries(channelId, sessionId || undefined),
  }
})

app.post('/api/summaries/:channelId/export', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const body = summariesExportSchema.parse(request.body ?? {})
    const ids = normalizePositiveIntIds(body.ids)
    if (ids.length === 0) {
      reply.code(400)
      return { ok: false, message: '请至少选择一条总结进行导出' }
    }

    const targetSessionId = body.sessionId?.trim() || undefined
    const source = listChannelSummaries(channelId, targetSessionId)
    const byId = new Map(source.map((s) => [s.id, s]))

    const selected = ids
      .map((id) => byId.get(id) ?? null)
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (selected.length !== ids.length) {
      const selectedIds = new Set(selected.map((x) => x.id))
      const missing = ids.filter((id) => !selectedIds.has(id))
      reply.code(400)
      return { ok: false, message: `以下总结不存在或不在当前会话中: ${missing.join(', ')}` }
    }

    // 导出阅读顺序：统一按时间从旧到新（优先 coversFrom，再回退 createdAt）
    const selectedSorted = [...selected].sort((a, b) => {
      const aFromMs = new Date(a.coversFrom || a.createdAt).getTime()
      const bFromMs = new Date(b.coversFrom || b.createdAt).getTime()
      const aFromOk = Number.isFinite(aFromMs)
      const bFromOk = Number.isFinite(bFromMs)

      if (aFromOk && bFromOk && aFromMs !== bFromMs) return aFromMs - bFromMs
      if (aFromOk && !bFromOk) return -1
      if (!aFromOk && bFromOk) return 1

      const aCreatedMs = new Date(a.createdAt).getTime()
      const bCreatedMs = new Date(b.createdAt).getTime()
      const aCreatedOk = Number.isFinite(aCreatedMs)
      const bCreatedOk = Number.isFinite(bCreatedMs)

      if (aCreatedOk && bCreatedOk && aCreatedMs !== bCreatedMs) return aCreatedMs - bCreatedMs
      if (aCreatedOk && !bCreatedOk) return -1
      if (!aCreatedOk && bCreatedOk) return 1

      return a.id - b.id
    })

    return {
      ok: true,
      data: {
        version: 1,
        exportedAt: nowIso(),
        channelId,
        sessionId: targetSessionId ?? null,
        count: selectedSorted.length,
        summaries: selectedSorted,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '批量导出总结失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/summaries/:channelId/import-merge', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const body = summariesImportMergeSchema.parse(request.body ?? {})
    const replaceIds = normalizePositiveIntIds(body.replaceIds)
    if (replaceIds.length === 0) {
      reply.code(400)
      return { ok: false, message: '请至少选择一条要覆盖的总结' }
    }

    const summaryText = body.summary.trim()
    if (!summaryText) {
      reply.code(400)
      return { ok: false, message: '导入总结内容不能为空' }
    }

    const requestedSessionId = body.sessionId?.trim() || undefined
    const all = listChannelSummaries(channelId, requestedSessionId)
    const byId = new Map(all.map((s) => [s.id, s]))

    const selected = replaceIds
      .map((id) => byId.get(id) ?? null)
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (selected.length !== replaceIds.length) {
      const selectedIds = new Set(selected.map((x) => x.id))
      const missing = replaceIds.filter((id) => !selectedIds.has(id))
      reply.code(400)
      return { ok: false, message: `以下总结不存在或不在当前会话中: ${missing.join(', ')}` }
    }

    const sessionSet = new Set(selected.map((s) => s.sessionId || 'default'))
    if (sessionSet.size !== 1) {
      reply.code(400)
      return { ok: false, message: '选中的总结跨会话，不能合并覆盖。请先筛选单一会话。' }
    }

    const targetSessionId = selected[0].sessionId || 'default'
    if (requestedSessionId && targetSessionId !== requestedSessionId) {
      reply.code(400)
      return { ok: false, message: '目标会话与所选总结会话不一致' }
    }

    const fromCandidates = selected
      .map((s) => s.coversFrom || s.createdAt)
      .filter(Boolean)
      .sort()
    const toCandidates = selected
      .map((s) => s.coversTo || s.createdAt)
      .filter(Boolean)
      .sort()

    const coversFrom = fromCandidates.length > 0 ? fromCandidates[0] : null
    const coversTo = toCandidates.length > 0 ? toCandidates[toCandidates.length - 1] : null
    const messageCount = selected.reduce((acc, s) => acc + Math.max(0, Number(s.messageCount ?? 0)), 0)
    const tokenCount = estimateTokens(summaryText)

    const db = getDb()
    const placeholders = replaceIds.map(() => '?').join(',')
    let insertedId = 0

    db.transaction(() => {
      db.prepare(`DELETE FROM channel_summaries WHERE channel_id = ? AND id IN (${placeholders})`).run(
        channelId,
        ...replaceIds
      )

      const inserted = db.prepare(`
        INSERT INTO channel_summaries (
          channel_id, session_id, summary, token_count, covers_from, covers_to, message_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        channelId,
        targetSessionId,
        summaryText,
        tokenCount,
        coversFrom,
        coversTo,
        messageCount,
        nowIso()
      )

      insertedId = Number(inserted.lastInsertRowid ?? 0)

      if (coversFrom && coversTo) {
        db.prepare(`
          UPDATE channel_messages
          SET is_summarized = 1
          WHERE channel_id = ? AND session_id = ?
            AND created_at >= ? AND created_at <= ?
        `).run(channelId, targetSessionId, coversFrom, coversTo)
      }
    })()

    const merged = insertedId > 0 ? getChannelSummaryById(insertedId) : null
    if (!merged) {
      reply.code(500)
      return { ok: false, message: '已覆盖旧总结，但读取新总结失败' }
    }

    return {
      ok: true,
      data: {
        replacedIds: replaceIds,
        replacedCount: replaceIds.length,
        summary: merged,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '导入大总结覆盖失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/summaries/:channelId/trigger', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const body = z.object({ sessionId: z.string().min(1).optional() }).parse(request.body ?? {})

    const cfg = getChannelConfig(channelId)
    if (!cfg) {
      reply.code(404)
      return { ok: false, message: '频道配置不存在' }
    }

    const targetSessionId = body.sessionId?.trim() || cfg.activeSessionId || 'default'
    const targetCfg = {
      ...cfg,
      activeSessionId: targetSessionId,
    }

    const beforeLatestId = listChannelSummaries(channelId, targetSessionId)[0]?.id ?? null
    await maybeSummarizeChannel(channelId, targetCfg, undefined, { force: true })
    const latest = listChannelSummaries(channelId, targetSessionId)[0] ?? null
    const created = latest?.id != null && latest.id !== beforeLatestId

    return {
      ok: true,
      data: {
        sessionId: targetSessionId,
        created,
        summary: created ? latest : null,
        latest,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '手动总结失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/summaries/:id/resummarize', async (request, reply) => {
  try {
    const { id } = request.params as { id: string }
    const numId = Number(id)
    if (!Number.isFinite(numId) || numId <= 0) {
      reply.code(400)
      return { ok: false, message: '无效的总结 ID' }
    }

    const oldSummary = getChannelSummaryById(numId)
    if (!oldSummary) {
      reply.code(404)
      return { ok: false, message: '总结不存在' }
    }

    if (!oldSummary.coversFrom || !oldSummary.coversTo) {
      reply.code(400)
      return { ok: false, message: '该总结缺少覆盖区间，无法重总结' }
    }

    const cfg = getChannelConfig(oldSummary.channelId)
    if (!cfg) {
      reply.code(404)
      return { ok: false, message: '对应频道配置不存在' }
    }

    const targetCfg: ChannelConfigRecord = {
      ...cfg,
      activeSessionId: oldSummary.sessionId || cfg.activeSessionId || 'default',
    }

    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM channel_messages
      WHERE channel_id = ? AND session_id = ?
        AND created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
    `).all(
      oldSummary.channelId,
      targetCfg.activeSessionId,
      oldSummary.coversFrom,
      oldSummary.coversTo
    ) as any[]

    const rangeMessages = rows.map(mapDbChannelMessageRow)
    if (rangeMessages.length === 0) {
      reply.code(400)
      return { ok: false, message: '该总结覆盖区间内没有可用于重总结的消息' }
    }

    const summaryCfg = getSummaryConfig()
    const endpoint = resolveSummaryEndpoint(targetCfg, summaryCfg)
    if (!endpoint) {
      reply.code(400)
      return { ok: false, message: '未找到可用的总结模型端点' }
    }

    const historyBlock = buildPromptHistoryBlock(rangeMessages, {
      timeZone: targetCfg.timeZone,
      silenceThresholdMinutes: targetCfg.silenceThreshold,
    })

    const systemPrompt = summaryCfg.summarySystemPrompt?.trim() || DEFAULT_SUMMARY_SYSTEM_PROMPT
    const userTemplate = summaryCfg.summaryUserPrompt?.trim() || DEFAULT_SUMMARY_USER_PROMPT
    const userContent = userTemplate.replace(/\{\{chatLog\}\}/gi, historyBlock.mergedUserContent)
    const previousSummaryContext = buildPreviousSummariesContext({
      channelId: oldSummary.channelId,
      sessionId: targetCfg.activeSessionId,
      maxItems: SUMMARY_CONTEXT_LIMIT,
      excludeSummaryId: oldSummary.id,
      beforeCreatedAt: oldSummary.createdAt,
    })

    const previousSummaryMessages: OpenAIMessage[] = previousSummaryContext
      ? [
          {
            role: 'system',
            content:
              '你会先收到“已有历史总结”作为上下文，再收到“待重总结的聊天日志”。请在继承历史的前提下重写该区间总结，避免重复复述旧内容。',
          },
          { role: 'user', content: `【已有历史总结】\n${previousSummaryContext}` },
        ]
      : []

    const summaryMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...previousSummaryMessages,
      { role: 'user', content: userContent },
    ]

    const summaryTemperature = summaryCfg.summaryTemperature ?? 0.2
    const summaryMaxTokens = summaryCfg.summaryMaxTokens > 0
      ? summaryCfg.summaryMaxTokens
      : Math.max(256, Math.floor(endpoint.maxTokens * 0.6))

    const out = await chatCompletions({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      messages: summaryMessages,
      temperature: summaryTemperature,
      topP: 1,
      maxTokens: summaryMaxTokens,
      extraParams: safeParseJsonObject(endpoint.extraParams),
      stream: false,
    })

    const summaryText = out.content.trim()
    if (!summaryText) {
      reply.code(400)
      return { ok: false, message: '模型未返回新的总结内容' }
    }

    const tokenCount = estimateTokens(summaryText)
    const ok = updateChannelSummary(numId, summaryText, tokenCount)
    if (!ok) {
      reply.code(404)
      return { ok: false, message: '总结不存在或已被删除' }
    }

    const updated = getChannelSummaryById(numId)
    return {
      ok: true,
      data: {
        summary: updated,
        rangeMessageCount: rangeMessages.length,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '重总结失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.put('/api/summaries/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string }
    const numId = Number(id)
    if (!Number.isFinite(numId) || numId <= 0) {
      reply.code(400)
      return { ok: false, message: '无效的总结 ID' }
    }
    const body = z.object({ summary: z.string().min(1) }).parse(request.body)
    const tokenCount = estimateTokens(body.summary)
    const ok = updateChannelSummary(numId, body.summary, tokenCount)
    if (!ok) {
      reply.code(404)
      return { ok: false, message: '总结不存在' }
    }
    const updated = getChannelSummaryById(numId)
    return { ok: true, data: updated }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '编辑总结失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.delete('/api/summaries/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const numId = Number(id)
  if (!Number.isFinite(numId) || numId <= 0) {
    reply.code(400)
    return { ok: false, message: '无效的总结 ID' }
  }
  const ok = deleteChannelSummary(numId)
  if (!ok) {
    reply.code(404)
    return { ok: false, message: '总结不存在' }
  }
  return { ok: true, message: '总结已删除' }
})

// ─── 聊天历史编辑/删除 API ─────────────────────────

app.put('/api/history/message/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string }
    const numId = Number(id)
    if (!Number.isFinite(numId) || numId <= 0) {
      reply.code(400)
      return { ok: false, message: '无效的消息 ID' }
    }
    const body = messageEditSchema.parse(request.body)
    const tokenCount = estimateTokens(body.content)
    updateChannelMessageContentById(numId, body.content, tokenCount)
    if (body.role) {
      updateChannelMessageRole(numId, body.role as MessageRole)
    }
    const updated = getChannelMessageById(numId)
    return { ok: true, data: updated }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '编辑消息失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/history/messages/delete', async (request, reply) => {
  try {
    const body = messageBatchDeleteSchema.parse(request.body)
    const count = deleteChannelMessagesByIds(body.ids)
    return { ok: true, data: { deleted: count } }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '删除消息失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.delete('/api/history/:channelId/clear', async (request) => {
  const { channelId } = request.params as { channelId: string }
  const { sessionId } = request.query as { sessionId?: string }
  let count: number
  if (sessionId) {
    count = clearChannelSessionHistory(channelId, sessionId)
  } else {
    count = clearChannelAllHistory(channelId)
  }
  return { ok: true, data: { deleted: count } }
})

// ─── 会话管理 API ─────────────────────────────────

app.get('/api/sessions/:channelId', async (request) => {
  const { channelId } = request.params as { channelId: string }
  const cfg = getChannelConfig(channelId)
  return {
    ok: true,
    data: {
      activeSessionId: cfg?.activeSessionId ?? 'default',
      sessions: listSessionsForChannel(channelId),
    },
  }
})

app.post('/api/sessions/:channelId/create', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const body = sessionCreateSchema.parse(request.body)
    const cfg = switchChannelSession(channelId, body.sessionId)
    return { ok: true, data: { activeSessionId: cfg.activeSessionId } }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '创建会话失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/sessions/:channelId/switch', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const body = sessionCreateSchema.parse(request.body)
    const cfg = switchChannelSession(channelId, body.sessionId)
    return { ok: true, data: { activeSessionId: cfg.activeSessionId } }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '切换会话失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

// ---------------- 变量 API ----------------

app.get('/api/variables/global', async () => {
  return { ok: true, data: listGlobalVariables() }
})

app.put('/api/variables/global', async (request, reply) => {
  try {
    const input = z.array(variableSetSchema).parse(request.body)
    for (const item of input) {
      setGlobalVariable(item.key, item.value)
    }
    return { ok: true, message: '全局变量已更新' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新全局变量失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.get('/api/variables/channel/:channelId', async (request) => {
  const { channelId } = request.params as { channelId: string }
  return { ok: true, data: listChannelVariables(channelId) }
})

app.put('/api/variables/channel/:channelId', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const input = z.array(variableSetSchema).parse(request.body)
    for (const item of input) {
      setChannelVariable(channelId, item.key, item.value)
    }
    return { ok: true, message: '频道变量已更新' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新频道变量失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

// ---------------- Macros / Prompt / LLM API ----------------

app.get('/api/macros/:channelId', async (request, reply) => {
  try {
    const { channelId } = request.params as { channelId: string }
    const { sessionId } = request.query as { sessionId?: string }
    const cfg = getChannelConfig(channelId)
    const xmlToolPrompt = cfg ? buildXmlToolPromptMacroForChannel(channelId, cfg) : ''
    const built = buildPromptForChannel(channelId, {
      historyLimit: normalizeHistoryLimit(cfg?.historyMessageLimit, 500),
      useUnsummarized: true,
      includeSummary: true,
      outputFormat: 'openai',
      view: 'model',
      sessionId: sessionId || undefined,
      extraMacros: { xmlToolPrompt },
    })

    // 为每个宏附加描述信息
    const macroDescriptions: Record<string, string> = {
      char: '角色名（从角色卡提取）',
      user: '用户显示名（频道设置 > userDisplayName）',
      charDescription: '角色描述（从角色卡提取）',
      currentTime: '当前时间（频道时区格式化）',
      isodate: '当前日期 (YYYY-MM-DD)',
      isotime: '当前时间 (HH:mm:ss)',
      idle_duration: '距上次用户发言的时间差',
      lastUserMessage: '最后一条用户消息内容',
      lastCharMessage: '最后一条角色/模型消息内容',
      lastChatMessage: '最后一条消息内容（角色优先）',
      lastUserAuthorId: '最后一条用户消息的 Discord ID',
      lastUserAuthorName: '最后一条用户消息的作者名',
      isOwner: '最后发言者是否为主人 (true/false)',
      ownerContext: '主人身份识别上下文（自动生成的权限描述）',
      participants: '频道参与者列表（含 Discord ID，用于 @提及）',
      summaryContent: '历史对话摘要内容',
      xmlToolPrompt: 'XML 工具调用提示词（在预设中使用 {{xmlToolPrompt}}）',
    }

    const entries = Object.entries(built.macros).map(([key, value]) => ({
      key,
      value,
      description: macroDescriptions[key] ?? '自定义宏（来自 customMacrosJson）',
      source: macroDescriptions[key] ? 'system' : 'custom',
    }))

    return {
      ok: true,
      data: {
        channelId,
        macroCount: entries.length,
        macros: entries,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '获取宏列表失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/prompt/build', async (request, reply) => {
  try {
    const input = promptBuildSchema.parse(request.body)
    const cfg = getChannelConfig(input.channelId)
    const xmlToolPrompt = cfg ? buildXmlToolPromptMacroForChannel(input.channelId, cfg) : ''
    const built = buildPromptForChannel(input.channelId, {
      historyLimit: input.historyLimit,
      useUnsummarized: input.useUnsummarized,
      includeSummary: input.includeSummary,
      outputFormat: input.outputFormat,
      view: input.view,
      sessionId: input.sessionId,
      extraMacros: { xmlToolPrompt },
    })

    return {
      ok: true,
      data: built,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '构建提示词失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/llm/discover-models', async (request, reply) => {
  try {
    const input = discoverModelsSchema.parse(request.body)
    const models = await discoverModels(input.baseUrl, input.apiKey)
    return { ok: true, data: models.map((m) => m.id) }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '模型发现失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/llm/chat', async (request, reply) => {
  try {
    const input = llmChatSchema.parse(request.body)
    const out = await chatCompletions({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      topP: input.topP,
      maxTokens: input.maxTokens,
      extraParams: input.extraParams,
      stream: false,
    })

    return {
      ok: true,
      data: {
        content: out.content,
        usage: out.usage ?? null,
        raw: out.raw,
      },
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'LLM 调用失败'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

app.post('/api/llm/chat/stream', async (request, reply) => {
  try {
    const input = llmChatSchema.parse(request.body)

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    ;(async () => {
      try {
        for await (const chunk of streamChatCompletions({
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          model: input.model,
          messages: input.messages,
          temperature: input.temperature,
          topP: input.topP,
          maxTokens: input.maxTokens,
          extraParams: input.extraParams,
          stream: true,
        })) {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
        }
        reply.raw.write('data: [DONE]\n\n')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'stream failed'
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`)
      } finally {
        reply.raw.end()
      }
    })()

    return reply
  } catch (error) {
    const msg = error instanceof Error ? error.message : '流式请求参数错误'
    reply.code(400)
    return { ok: false, message: msg }
  }
})

async function bootstrap() {
  try {
    try {
      await mcpManager.initialize()
      const registeredTools = mcpManager.getOpenAITools()
      app.log.info(
        {
          toolCount: registeredTools.length,
          tools: registeredTools.map((t) => t.function.name),
        },
        'MCP 初始化完成，已注册工具'
      )
    } catch (mcpError) {
      app.log.error({ err: mcpError }, 'MCP 初始化失败，将继续以无工具模式运行')
    }

    // 自动注册默认 LLM 端点
    const defaultBaseUrl = process.env.DEFAULT_LLM_BASE_URL?.trim()
    const defaultModel = process.env.DEFAULT_LLM_MODEL?.trim()
    if (defaultBaseUrl && defaultModel) {
      upsertEndpoint({
        id: '__default__',
        name: '默认端点 (env)',
        baseUrl: defaultBaseUrl,
        apiKey: process.env.DEFAULT_LLM_API_KEY ?? '',
        model: defaultModel,
        maxTokens: Number(process.env.DEFAULT_LLM_MAX_TOKENS) || 4096,
        temperature: Number(process.env.DEFAULT_LLM_TEMPERATURE) || 0.7,
        topP: 1,
        extraParams: '{}',
        reasoningMaxTokens: 0,
        reasoningEffort: '',
        showThinking: false,
      })
      app.log.info(`已自动注册默认 LLM 端点: ${defaultModel} @ ${defaultBaseUrl}`)
    }

    // ─── MCP 诊断接口 ────────────────────────────────────
    app.get('/api/mcp/tools', async () => {
      const tools = mcpManager.getOpenAITools()
      return {
        ok: true,
        data: {
          toolCount: tools.length,
          tools: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description?.slice(0, 120) ?? '',
          })),
        },
      }
    })

    await app.listen({ port: PORT, host: HOST })
    app.log.info(`HTTP server running on http://${HOST}:${PORT}`)

    // 自动连接 Discord
    const autoToken = process.env.DISCORD_BOT_TOKEN?.trim()
    if (autoToken) {
      const autoIntents = (process.env.DISCORD_AUTO_INTENTS ?? 'Guilds,GuildMessages,MessageContent')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      try {
        const info = await discordRuntime.start(autoToken, autoIntents)
        app.log.info({ ...info, intents: autoIntents }, 'Discord Runtime 自动启动成功')
      } catch (err) {
        app.log.error({ err }, 'Discord Runtime 自动启动失败')
      }
    } else {
      app.log.info('未设置 DISCORD_BOT_TOKEN，跳过 Discord 自动连接')
    }
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

bootstrap()