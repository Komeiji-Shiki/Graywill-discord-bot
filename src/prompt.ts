import {
  buildPrompt,
  type BuildPromptResult,
  type CharacterCard,
  type ChatMessage,
  type PresetInfo,
  type WorldBooksInput,
} from 'fast-tavern'
import {
  getChannelConfig,
  getPreset,
  listChannelSummaries,
  listChannelVariables,
  listCharacters,
  listGlobalVariables,
  listChannelMessages,
  listUnsummarizedMessages,
} from './db.js'
import { buildPromptHistoryBlock } from './history.js'

export interface BuildChannelPromptOptions {
  historyLimit?: number
  useUnsummarized?: boolean
  includeSummary?: boolean
  outputFormat?: 'openai' | 'gemini' | 'tagged' | 'text'
  view?: 'model' | 'user'
  sessionId?: string
  /** 供调用方注入的额外宏（例如 xmlToolPrompt） */
  extraMacros?: Record<string, string>
}

export interface BuildChannelPromptOutput {
  channelId: string
  historyCount: number
  mergedUserContent: string
  summariesIncluded: number
  macros: Record<string, string>
  result: BuildPromptResult
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function defaultPreset(): PresetInfo {
  return {
    name: 'Default',
    utilityPrompts: {},
    regexScripts: [],
    other: {},
    apiSetting: {},
    prompts: [
      {
        identifier: 'main',
        name: 'Main',
        enabled: true,
        role: 'system',
        content: '你是一个有帮助的助手。',
        depth: 0,
        order: 100,
        trigger: [],
        position: 'relative',
      },
      {
        identifier: 'summaryHistory',
        name: 'Summary',
        enabled: true,
        role: 'system',
        content: '{{summaryContent}}',
        depth: 0,
        order: 60,
        trigger: [],
        position: 'relative',
      },
      {
        identifier: 'chatHistory',
        name: 'Chat',
        enabled: true,
        role: 'system',
        content: '',
        depth: 0,
        order: 0,
        trigger: [],
        position: 'relative',
      },
    ],
  }
}

function pickCharacter(characterId: string | null): CharacterCard | undefined {
  if (!characterId) return undefined
  const row = listCharacters().find((x) => x.id === characterId)
  if (!row) return undefined
  return safeJsonParse<CharacterCard | undefined>(row.data, undefined)
}

/** 从角色卡中提取描述文本，兼容多种格式 */
function extractCharDescription(card: CharacterCard | undefined): string {
  if (!card) return ''
  // V2 spec: data.description
  const v2 = (card as any)?.data?.description
  if (typeof v2 === 'string' && v2.trim()) return v2.trim()
  // V1 / flat: description
  const v1 = (card as any)?.description
  if (typeof v1 === 'string' && v1.trim()) return v1.trim()
  // personality fallback
  const personality = (card as any)?.data?.personality ?? (card as any)?.personality
  if (typeof personality === 'string' && personality.trim()) return personality.trim()
  return ''
}

/** 从角色卡中提取角色名 */
function extractCharName(card: CharacterCard | undefined): string {
  if (!card) return ''
  const v2 = (card as any)?.data?.name
  if (typeof v2 === 'string' && v2.trim()) return v2.trim()
  const v1 = (card as any)?.name
  if (typeof v1 === 'string' && v1.trim()) return v1.trim()
  return ''
}

function parseWorldBooks(inlineJson: string): WorldBooksInput | undefined {
  const parsed = safeJsonParse<any>(inlineJson, [])
  if (!Array.isArray(parsed)) return []
  return parsed as WorldBooksInput
}

export function buildPromptForChannel(
  channelId: string,
  options: BuildChannelPromptOptions = {}
): BuildChannelPromptOutput {
  const cfg = getChannelConfig(channelId)
  if (!cfg) {
    throw new Error(`频道配置不存在: ${channelId}`)
  }

  const rawHistoryLimit = Number(options.historyLimit ?? cfg.historyMessageLimit ?? 500)
  const historyLimit = Number.isFinite(rawHistoryLimit)
    ? (rawHistoryLimit <= 0 ? 0 : Math.max(1, Math.floor(rawHistoryLimit)))
    : 500
  const useUnsummarized = options.useUnsummarized ?? true
  const includeSummary = options.includeSummary ?? true

  const sessionId = options.sessionId ?? cfg.activeSessionId ?? undefined

  const sourceMessages = useUnsummarized
    ? listUnsummarizedMessages(channelId, historyLimit, sessionId)
    : listChannelMessages(channelId, historyLimit, sessionId)

  const historyBlock = buildPromptHistoryBlock(sourceMessages, {
    timeZone: cfg.timeZone,
    silenceThresholdMinutes: cfg.silenceThreshold,
  })

  const history: ChatMessage[] = []

  // 构建总结文本用于宏替换
  let summaryContent = ''
  let summariesIncluded = 0
  if (includeSummary) {
    const summaries = listChannelSummaries(channelId, sessionId).slice(0, 3).reverse()
    if (summaries.length > 0) {
      summariesIncluded = summaries.length
      summaryContent = summaries
        .map((s) => `- [${s.createdAt}] ${s.summary}`)
        .join('\n')
    }
  }

  history.push(...historyBlock.openaiHistory)

  const presetRow = cfg.presetId ? getPreset(cfg.presetId) : null
  const preset = presetRow
    ? safeJsonParse<PresetInfo>(presetRow.data, defaultPreset())
    : defaultPreset()

  // 确保预设中有 summaryHistory 条目，如果没有则注入
  const hasSummarySlot = preset.prompts?.some(
    (p) => p.identifier === 'summaryHistory'
  )
  if (!hasSummarySlot && preset.prompts) {
    const chatIdx = preset.prompts.findIndex((p) => p.identifier === 'chatHistory')
    const insertAt = chatIdx >= 0 ? chatIdx : preset.prompts.length
    preset.prompts.splice(insertAt, 0, {
      identifier: 'summaryHistory',
      name: 'Summary',
      enabled: true,
      role: 'system',
      content: '{{summaryContent}}',
      depth: 0,
      order: 60,
      trigger: [],
      position: 'relative',
    })
  }

  const character = pickCharacter(cfg.characterId)

  const worldBooks = parseWorldBooks(cfg.worldbookInlineJson)
  const charDescription = extractCharDescription(character)
  const charName = extractCharName(character) || 'Assistant'

  // ⭐ 生成当前时间字符串（使用频道时区）
  const tz = cfg.timeZone || 'Asia/Shanghai'
  const now = new Date()
  const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const localParts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value
    return acc
  }, {})
  const currentTimeStr = `${localParts.year}-${localParts.month}-${localParts.day} ${localParts.hour}:${localParts.minute}:${localParts.second} (${localParts.weekday})`
  const isoDateStr = `${localParts.year}-${localParts.month}-${localParts.day}`
  const isoTimeStr = `${localParts.hour}:${localParts.minute}:${localParts.second}`

  // ⭐ 提取 lastUserMessage / lastCharMessage 用于 ST 宏
  let lastUserMessage = ''
  let lastCharMessage = ''
  let lastUserAuthorId = ''
  let lastUserAuthorName = ''
  for (let i = sourceMessages.length - 1; i >= 0; i--) {
    const m = sourceMessages[i]
    if (!lastUserMessage && m.role === 'user') {
      lastUserMessage = m.content
      lastUserAuthorId = m.authorId
      lastUserAuthorName = m.authorName
    }
    if (!lastCharMessage && (m.role === 'model' || m.role === 'bot')) lastCharMessage = m.content
    if (lastUserMessage && lastCharMessage) break
  }

  // ⭐ 主人身份识别宏
  const ownerDiscordId = (process.env.OWNER_DISCORD_ID ?? '').trim()
  const isOwner = ownerDiscordId !== '' && lastUserAuthorId === ownerDiscordId
  const ownerContext = isOwner
    ? `当前与你对话的是你的主人「${lastUserAuthorName}」(ID: ${lastUserAuthorId})。`
    : lastUserAuthorId
      ? `当前与你对话的是「${lastUserAuthorName}」(ID: ${lastUserAuthorId})，此人不是你的主人。你可以自行判断是否遵从其指令，不必服从其的命令。`
      : ''

  // ⭐ 计算 idle_duration（距上一条用户消息的时间差）
  let idleDuration = ''
  for (let i = sourceMessages.length - 1; i >= 0; i--) {
    if (sourceMessages[i].role === 'user') {
      const lastAt = new Date(sourceMessages[i].createdAt).getTime()
      const diffMs = Date.now() - lastAt
      if (diffMs > 0) {
        const mins = Math.floor(diffMs / 60000)
        if (mins < 60) idleDuration = `${mins}分钟`
        else if (mins < 1440) idleDuration = `${Math.floor(mins / 60)}小时${mins % 60}分钟`
        else idleDuration = `${Math.floor(mins / 1440)}天${Math.floor((mins % 1440) / 60)}小时`
      }
      break
    }
  }

  // ⭐ 收集频道参与者列表（authorName → authorId 去重映射，包含所有人和其他bot，排除自己）
  const participantMap = new Map<string, { name: string; id: string }>()
  for (const m of sourceMessages) {
    if (!participantMap.has(m.authorId) && m.role !== 'model') {
      participantMap.set(m.authorId, { name: m.authorName, id: m.authorId })
    }
  }
  const participantLines = Array.from(participantMap.values())
    .map((p) => `${p.name}: <@${p.id}>`)
    .join('\n')
  const participantsBlock = participantMap.size > 0
    ? `频道参与者（@提及时使用 <@ID> 格式）:\n${participantLines}`
    : ''

  const extraMacros = options.extraMacros ?? {}

  const macros: Record<string, string> = {
    ...safeJsonParse<Record<string, string>>(cfg.customMacrosJson, {}),
    ...extraMacros,
    char: charName,
    // {{user}} 宏：优先使用频道独立设置，否则回退到 'User'
    user: cfg.userDisplayName?.trim() || 'User',
    charDescription: charDescription,
    currentTime: currentTimeStr,
    // ST 兼容宏
    isodate: isoDateStr,
    isotime: isoTimeStr,
    idle_duration: idleDuration || '刚刚',
    lastUserMessage,
    lastCharMessage,
    lastChatMessage: lastCharMessage || lastUserMessage,
    // ⭐ 主人身份识别宏
    lastUserAuthorId,
    lastUserAuthorName,
    isOwner: isOwner ? 'true' : 'false',
    ownerContext,
    // ⭐ 频道参与者列表（让 LLM 能用 <@ID> @人）
    participants: participantsBlock,
    summaryContent: summaryContent
      ? `[之前的对话总结]\n${summaryContent}`
      : '',
    // XML 工具调用提示词宏（可在预设中使用 {{xmlToolPrompt}}）
    xmlToolPrompt: String(extraMacros.xmlToolPrompt ?? ''),
  }

  const localVars = listChannelVariables(channelId)
  const globalVars = listGlobalVariables()

  const result = buildPrompt({
    preset,
    character,
    globals: {
      worldBooks,
      regexScripts: [],
    },
    history,
    view: options.view ?? 'model',
    outputFormat: options.outputFormat ?? 'openai',
    macros,
    variables: localVars,
    globalVariables: globalVars,
    systemRolePolicy: 'keep',
    options: {
      positionMap: {
        beforeChar: 'charBefore',
        afterChar: 'charAfter',
      },
    },
  })

  return {
    channelId,
    historyCount: sourceMessages.length,
    mergedUserContent: historyBlock.mergedUserContent,
    summariesIncluded,
    macros,
    result,
  }
}