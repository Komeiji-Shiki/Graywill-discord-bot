export interface XmlCompatToolDef {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export interface XmlParsedToolCall {
  name: string
  arguments: Record<string, unknown>
  rawArguments: string
  rawBlock: string
}

function parseSimpleKeyValueArgs(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = raw
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const valueRaw = line.slice(idx + 1).trim()
    if (!key) continue

    let value: unknown = valueRaw
    if (/^(true|false)$/i.test(valueRaw)) {
      value = valueRaw.toLowerCase() === 'true'
    } else if (/^(null|none)$/i.test(valueRaw)) {
      value = null
    } else if (/^-?\d+$/.test(valueRaw)) {
      value = Number.parseInt(valueRaw, 10)
    } else if (/^-?\d+\.\d+$/.test(valueRaw)) {
      value = Number.parseFloat(valueRaw)
    } else if (
      (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
      (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
    ) {
      value = valueRaw.slice(1, -1)
    }

    out[key] = value
  }

  return out
}

function cleanArgumentsRaw(raw: string): string {
  let text = String(raw ?? '').trim()
  if (!text) return '{}'

  // 去掉 ```json / ``` 包裹
  text = text.replace(/^```[a-zA-Z]*\s*/g, '').replace(/\s*```$/g, '').trim()
  return text || '{}'
}

function parseArgumentsObject(raw: string): Record<string, unknown> {
  const text = cleanArgumentsRaw(raw)
  if (!text) return {}

  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    const fallback = parseSimpleKeyValueArgs(text)
    return fallback
  }
}

function parseNewFormatBlock(rawBlock: string): XmlParsedToolCall | null {
  const body = rawBlock
    .replace(/^<<<tool_call>>>/i, '')
    .replace(/<<<\/tool_call>>>$/i, '')
    .trim()

  const nameMatch = body.match(/name\s*:\s*([^\n<]+)/i)
  const name = nameMatch?.[1]?.trim() ?? ''
  if (!name) return null

  const argsMatch = body.match(/arguments\s*:\s*([\s\S]*)$/i)
  const rawArguments = cleanArgumentsRaw(argsMatch?.[1] ?? '{}')
  const argumentsObject = parseArgumentsObject(rawArguments)

  return {
    name,
    arguments: argumentsObject,
    rawArguments,
    rawBlock,
  }
}

function parseOldFormatBlock(rawBlock: string): XmlParsedToolCall | null {
  const nameMatch = rawBlock.match(/<name>\s*([\s\S]*?)\s*<\/name>/i)
  const name = nameMatch?.[1]?.trim() ?? ''
  if (!name) return null

  const argsMatch = rawBlock.match(/<arguments>\s*([\s\S]*?)\s*<\/arguments>/i)
  const rawArguments = cleanArgumentsRaw(argsMatch?.[1] ?? '{}')
  const argumentsObject = parseArgumentsObject(rawArguments)

  return {
    name,
    arguments: argumentsObject,
    rawArguments,
    rawBlock,
  }
}

/**
 * 解析模型输出中的 XML 工具调用，支持：
 * 1) <<<tool_call>>> ... <<</tool_call>>>
 * 2) <tool_call> ... </tool_call>
 */
export function parseXmlToolCalls(content: string): XmlParsedToolCall[] {
  const text = String(content ?? '')
  if (!text) return []

  const out: XmlParsedToolCall[] = []
  const pattern = /(<<<tool_call>>>[\s\S]*?<<<\/tool_call>>>|<tool_call>[\s\S]*?<\/tool_call>)/gi
  const matches = text.matchAll(pattern)

  for (const m of matches) {
    const rawBlock = String(m[0] ?? '').trim()
    if (!rawBlock) continue

    const parsed = rawBlock.startsWith('<<<tool_call>>>')
      ? parseNewFormatBlock(rawBlock)
      : parseOldFormatBlock(rawBlock)

    if (parsed) out.push(parsed)
  }

  return out
}

/**
 * 清理输出中的 XML 工具调用块，保留普通正文。
 */
export function stripXmlToolCalls(content: string): string {
  const text = String(content ?? '')
  if (!text) return ''

  return text
    .replace(/<<<tool_call>>>[\s\S]*?<<<\/tool_call>>>/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .trim()
}

function toToolDef(x: unknown): XmlCompatToolDef | null {
  if (!x || typeof x !== 'object') return null
  const obj = x as { type?: unknown; function?: unknown }

  if (obj.type === 'function' && obj.function && typeof obj.function === 'object') {
    const fn = obj.function as {
      name?: unknown
      description?: unknown
      parameters?: unknown
    }
    const name = typeof fn.name === 'string' ? fn.name.trim() : ''
    if (!name) return null
    return {
      name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters:
        fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters)
          ? (fn.parameters as Record<string, unknown>)
          : { type: 'object', properties: {} },
    }
  }

  const plain = x as { name?: unknown; description?: unknown; parameters?: unknown }
  const plainName = typeof plain.name === 'string' ? plain.name.trim() : ''
  if (!plainName) return null
  return {
    name: plainName,
    description: typeof plain.description === 'string' ? plain.description : '',
    parameters:
      plain.parameters && typeof plain.parameters === 'object' && !Array.isArray(plain.parameters)
        ? (plain.parameters as Record<string, unknown>)
        : { type: 'object', properties: {} },
  }
}

/**
 * 为不支持原生 tool_calls 的模型构建 XML 工具调用提示词。
 */
export function buildXmlToolSystemPrompt(toolsInput: unknown[]): string {
  const defs = toolsInput.map(toToolDef).filter((x): x is XmlCompatToolDef => x !== null)
  if (defs.length === 0) {
    return '当前没有可用工具。'
  }

  const toolLines = defs.map((t, i) => {
    const schema = JSON.stringify(t.parameters ?? { type: 'object', properties: {} })
    return `${i + 1}. ${t.name}\n描述: ${t.description || '无'}\n参数(JSON Schema): ${schema}`
  })

  return [
    '你可以使用工具来完成任务。当前环境不支持原生 tool_calls JSON 字段。',
    '当且仅当需要调用工具时，请在回复中输出以下格式：',
    '<<<tool_call>>>',
    'name: 工具名',
    'arguments: {"key":"value"}',
    '<<</tool_call>>>',
    '',
    '严格要求：',
    '1) arguments 必须是合法 JSON 对象，不要写注释、不要写多余文本。',
    '2) 每次只输出一个工具调用块。系统检测到完整块后会立即截断你的输出并执行工具，多余输出会丢失。',
    '3) 如果需要调用工具，先输出正文（如有），然后在最后输出工具调用块。工具调用块之后不要再写任何内容。',
    '4) 收到工具结果后，再基于结果继续回答或调用下一个工具。',
    '5) 不需要调用工具时，直接正常回复即可。',
    '',
    '可用工具如下：',
    ...toolLines,
  ].join('\n')
}