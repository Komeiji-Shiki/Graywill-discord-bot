import type { ChannelMessageRecord, MessageRole } from './db.js'

export interface BuildHistoryOptions {
  timeZone?: string
  silenceThresholdMinutes?: number
}

export type TimelineRow =
  | { type: 'month'; text: string }
  | { type: 'day'; text: string }
  | { type: 'silence'; text: string }
  | { type: 'message'; role: 'user' | 'bot'; time: string; author: string; content: string }

export interface GroupedRoleBlock {
  role: 'user' | 'bot'
  items: Array<{
    time: string
    author: string
    content: string
  }>
}

function toRoleForDisplay(role: MessageRole): 'user' | 'bot' {
  return role === 'bot' || role === 'model' ? 'bot' : 'user'
}

function formatByTimeZone(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, ...opts }).format(date)
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function getLocalParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})

  const year = Number(parts.year ?? 0)
  const month = Number(parts.month ?? 0)
  const day = Number(parts.day ?? 0)
  const hour = Number(parts.hour ?? 0)
  const minute = Number(parts.minute ?? 0)

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: parts.weekday ?? '',
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    monthKey: `${parts.year}-${parts.month}`,
    timeHHmm: `${pad2(hour)}:${pad2(minute)}`,
  }
}

export function buildTimelineRows(
  messages: ChannelMessageRecord[],
  options: BuildHistoryOptions = {}
): TimelineRow[] {
  const timeZone = options.timeZone ?? 'Asia/Shanghai'
  const silenceThreshold = options.silenceThresholdMinutes ?? 180

  const rows: TimelineRow[] = []
  let lastDateKey: string | null = null
  let lastMonthKey: string | null = null
  let prevTimeMs: number | null = null

  for (const msg of messages) {
    const dt = new Date(msg.createdAt)
    const p = getLocalParts(dt, timeZone)

    if (p.monthKey !== lastMonthKey) {
      rows.push({ type: 'month', text: `======== ${p.year}年${p.month}月 ========` })
      lastMonthKey = p.monthKey
      lastDateKey = null
    }

    if (p.dateKey !== lastDateKey) {
      rows.push({ type: 'day', text: `──── ${p.dateKey} (${p.weekday}) ────` })
      lastDateKey = p.dateKey
    }

    if (prevTimeMs !== null) {
      const gapMinutes = Math.floor((dt.getTime() - prevTimeMs) / 60000)
      if (gapMinutes >= silenceThreshold) {
        const h = Math.floor(gapMinutes / 60)
        const m = gapMinutes % 60
        const gapText =
          h > 0 ? (m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`) : `${m} 分钟`
        rows.push({ type: 'silence', text: `··· 沉默了 ${gapText} ···` })
      }
    }
    prevTimeMs = dt.getTime()

    rows.push({
      type: 'message',
      role: toRoleForDisplay(msg.role),
      time: p.timeHHmm,
      author: msg.authorName,
      content: msg.content,
    })
  }

  return rows
}

export function groupTimelineByRole(rows: TimelineRow[]): Array<TimelineRow | { type: 'group'; block: GroupedRoleBlock }> {
  const out: Array<TimelineRow | { type: 'group'; block: GroupedRoleBlock }> = []

  for (const row of rows) {
    if (row.type !== 'message') {
      out.push(row)
      continue
    }

    const last = out[out.length - 1]
    if (last && 'type' in last && last.type === 'group' && last.block.role === row.role) {
      last.block.items.push({
        time: row.time,
        author: row.author,
        content: row.content,
      })
    } else {
      out.push({
        type: 'group',
        block: {
          role: row.role,
          items: [
            {
              time: row.time,
              author: row.author,
              content: row.content,
            },
          ],
        },
      })
    }
  }

  return out
}

export function buildMergedUserChatLog(rows: TimelineRow[]): string {
  const lines: string[] = []

  for (const row of rows) {
    if (row.type === 'month' || row.type === 'day' || row.type === 'silence') {
      lines.push(row.text)
      lines.push('')
      continue
    }

    lines.push(`[${row.time}] ${row.author}: ${row.content}`)
  }

  return lines.join('\n').trim()
}

/**
 * 给 LLM 的 history（满足你要求：群聊作为单条 role:user）
 */
export function buildPromptHistoryBlock(
  messages: ChannelMessageRecord[],
  options: BuildHistoryOptions = {}
): {
  rows: TimelineRow[]
  grouped: Array<TimelineRow | { type: 'group'; block: GroupedRoleBlock }>
  mergedUserContent: string
  openaiHistory: Array<{ role: 'user'; content: string }>
} {
  const rows = buildTimelineRows(messages, options)
  const grouped = groupTimelineByRole(rows)
  const mergedUserContent = buildMergedUserChatLog(rows)

  return {
    rows,
    grouped,
    mergedUserContent,
    openaiHistory: [{ role: 'user', content: mergedUserContent }],
  }
}