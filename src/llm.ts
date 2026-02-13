export type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool'

export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ImageContentPart {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}

export type ContentPart = TextContentPart | ImageContentPart

export interface OpenAIMessage {
  role: OpenAIRole
  content: string | ContentPart[]
  name?: string
  tool_call_id?: string
}

/**
 * 下载图片并转为 base64 data URI，兼容 Gemini 等不支持外部 URL 的后端。
 * 失败时返回 null。
 */
export async function imageUrlToDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    // 从 Content-Type 或 URL 后缀推断 mime type
    let mime = res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!mime || mime === 'application/octet-stream') {
      const ext = url.replace(/[?#].*$/, '').split('.').pop()?.toLowerCase() ?? ''
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
      }
      mime = mimeMap[ext] || 'image/png'
    }
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * 将纯文本 content 与图片 data URI 列表合并为多模态 content
 */
export function buildMultimodalContent(
  text: string,
  imageDataUris: string[],
  detail: 'auto' | 'low' | 'high' = 'auto'
): string | ContentPart[] {
  if (imageDataUris.length === 0) return text
  const parts: ContentPart[] = []
  if (text) parts.push({ type: 'text', text })
  for (const uri of imageDataUris) {
    parts.push({ type: 'image_url', image_url: { url: uri, detail } })
  }
  return parts
}

/**
 * 提取 OpenAIMessage 的纯文本内容（忽略图片部分）
 */
export function extractTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

export interface OpenAIModelInfo {
  id: string
  object?: string
  owned_by?: string
}

export interface OpenAIUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface ChatCompletionParams {
  baseUrl: string
  apiKey?: string
  model: string
  messages: OpenAIMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  /** 思考预算（0/undefined 表示不显式指定） */
  reasoningMaxTokens?: number
  /** 思考努力程度 */
  reasoningEffort?: '' | 'auto' | 'low' | 'medium' | 'high'
  /** 是否产出 thinking chunk（仅影响本地流式解析输出，不影响请求体） */
  showThinking?: boolean
  stream?: boolean
  extraParams?: Record<string, unknown>
  tools?: unknown[]
}

export interface ChatCompletionResult {
  content: string
  usage?: OpenAIUsage
  raw: any
}

export interface StreamChunk {
  type: 'thinking' | 'content' | 'tool_call' | 'done'
  text?: string
  toolCall?: unknown
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  raw?: any
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * 从 HTTP 错误响应文本中提取有意义的错误信息。
 * 如果响应是 HTML（如 Cloudflare 错误页），提取标题和错误码；
 * 如果是 JSON 错误，提取 message 字段。
 */
function extractErrorMessage(status: number, text: string): string {
  const trimmed = text.trim()

  // 尝试 JSON 解析
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const msg = parsed?.error?.message ?? parsed?.message ?? parsed?.detail ?? ''
      if (typeof msg === 'string' && msg.length > 0 && msg.length < 500) {
        return `HTTP ${status}: ${msg}`
      }
    } catch {
      // fall through
    }
  }

  // HTML 错误页面：提取 <title> 内容
  const titleMatch = trimmed.match(/<title[^>]*>(.*?)<\/title>/i)
  if (titleMatch) {
    return `HTTP ${status}: ${titleMatch[1].trim()}`
  }

  // 纯文本，截断避免日志爆炸
  if (trimmed.length > 200) {
    return `HTTP ${status}: ${trimmed.slice(0, 200)}...`
  }

  return `HTTP ${status}: ${trimmed || 'empty response'}`
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }
  return headers
}

function applyReasoningParams(body: Record<string, unknown>, params: ChatCompletionParams) {
  const effort = String(params.reasoningEffort ?? '').trim()
  const maxTokensRaw = Number(params.reasoningMaxTokens ?? 0)
  const maxTokens = Number.isFinite(maxTokensRaw) ? Math.max(0, Math.floor(maxTokensRaw)) : 0

  if (!effort && maxTokens <= 0) return

  const reasoning: Record<string, unknown> = {}
  if (effort) reasoning.effort = effort
  if (maxTokens > 0) reasoning.max_tokens = maxTokens

  // 常见兼容写法：对象 + 扁平字段同时提供，便于不同 OpenAI-compatible 后端识别
  body.reasoning = reasoning
  if (effort) body.reasoning_effort = effort
  if (maxTokens > 0) body.max_reasoning_tokens = maxTokens
}

export async function discoverModels(baseUrl: string, apiKey?: string): Promise<OpenAIModelInfo[]> {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/models`
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: buildHeaders(apiKey),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`discoverModels failed: ${extractErrorMessage(res.status, text)}`)
  }

  const payload = text ? JSON.parse(text) : {}
  if (Array.isArray(payload?.data)) {
    return payload.data
      .map((x: any) => ({ id: String(x?.id ?? ''), object: x?.object, owned_by: x?.owned_by }))
      .filter((x: OpenAIModelInfo) => !!x.id)
  }

  if (Array.isArray(payload)) {
    return payload
      .map((x: any) => ({ id: String(x?.id ?? x?.model ?? '') }))
      .filter((x: OpenAIModelInfo) => !!x.id)
  }

  return []
}

export async function chatCompletions(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const endpoint = `${normalizeBaseUrl(params.baseUrl)}/chat/completions`
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
    top_p: params.topP ?? 1,
    max_tokens: params.maxTokens ?? 1024,
    stream: false,
    ...(params.extraParams ?? {}),
  }

  applyReasoningParams(body, params)

  if (Array.isArray(params.tools) && params.tools.length > 0) {
    body.tools = params.tools
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(params.apiKey),
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`chatCompletions failed: ${extractErrorMessage(res.status, text)}`)
  }

  const payload = text ? JSON.parse(text) : {}
  const content = String(payload?.choices?.[0]?.message?.content ?? '')

  return {
    content,
    usage: payload?.usage,
    raw: payload,
  }
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let splitIndex = buffer.indexOf('\n\n')
    while (splitIndex >= 0) {
      const rawEvent = buffer.slice(0, splitIndex)
      buffer = buffer.slice(splitIndex + 2)

      const lines = rawEvent
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') return

        try {
          yield JSON.parse(data)
        } catch {
          // 忽略非 JSON 数据行
        }
      }

      splitIndex = buffer.indexOf('\n\n')
    }
  }

  // flush
  if (buffer.trim()) {
    const lines = buffer
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        yield JSON.parse(data)
      } catch {
        // ignore
      }
    }
  }
}

export async function* streamChatCompletions(
  params: ChatCompletionParams
): AsyncGenerator<StreamChunk> {
  const endpoint = `${normalizeBaseUrl(params.baseUrl)}/chat/completions`
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
    top_p: params.topP ?? 1,
    max_tokens: params.maxTokens ?? 1024,
    stream: true,
    ...(params.extraParams ?? {}),
  }

  applyReasoningParams(body, params)

  if (Array.isArray(params.tools) && params.tools.length > 0) {
    body.tools = params.tools
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(params.apiKey),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`streamChatCompletions failed: ${extractErrorMessage(res.status, text)}`)
  }

  if (!res.body) {
    throw new Error('streamChatCompletions failed: empty response body')
  }

  for await (const packet of parseSSE(res.body)) {
    const choice = packet?.choices?.[0]
    const delta = choice?.delta ?? {}

    const reasoningText =
      typeof delta?.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta?.reasoning === 'string'
          ? delta.reasoning
          : ''

    if (params.showThinking !== false && reasoningText.length > 0) {
      yield {
        type: 'thinking',
        text: reasoningText,
        raw: packet,
      }
    }

    if (typeof delta?.content === 'string' && delta.content.length > 0) {
      yield {
        type: 'content',
        text: delta.content,
        raw: packet,
      }
    }

    if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
      for (const tc of delta.tool_calls) {
        yield {
          type: 'tool_call',
          toolCall: tc,
          raw: packet,
        }
      }
    }

    if (packet?.usage) {
      const prompt = Number(packet.usage.prompt_tokens ?? 0)
      const completion = Number(packet.usage.completion_tokens ?? 0)
      const total = Number(packet.usage.total_tokens ?? prompt + completion)
      yield {
        type: 'done',
        usage: {
          inputTokens: prompt,
          outputTokens: completion,
          totalTokens: total,
        },
        raw: packet,
      }
    }
  }
}