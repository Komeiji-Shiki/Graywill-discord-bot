import { ref } from 'vue'

export interface ApiErrorPayload {
  message: string
  status?: number
  details?: unknown
}

export interface ApiResponse<T> {
  ok: boolean
  data: T
}

export interface RequestOptions extends RequestInit {
  query?: Record<string, string | number | boolean | null | undefined>
}

const API_BASE = '/api'

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue
      url.searchParams.set(key, String(value))
    }
  }
  return `${url.pathname}${url.search}`
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { query, headers, ...init } = options

  // 只有有 body 时才设置 Content-Type: application/json
  const finalHeaders: Record<string, string> = { ...(headers as Record<string, string> ?? {}) }
  if (init.body !== undefined && init.body !== null) {
    finalHeaders['Content-Type'] = 'application/json'
  }

  const res = await fetch(buildUrl(path, query), {
    ...init,
    headers: finalHeaders,
  })

  const text = await res.text()
  const payload = text ? JSON.parse(text) : null

  if (!res.ok) {
    const err: ApiErrorPayload = {
      message: payload?.message ?? `请求失败: ${res.status}`,
      status: res.status,
      details: payload,
    }
    throw err
  }

  if (payload && typeof payload === 'object' && 'ok' in payload && 'data' in payload) {
    return (payload as ApiResponse<T>).data
  }

  return payload as T
}

export function useApi() {
  const loading = ref(false)
  const error = ref<ApiErrorPayload | null>(null)

  async function run<T>(path: string, options: RequestOptions = {}): Promise<T> {
    loading.value = true
    error.value = null
    try {
      return await request<T>(path, options)
    } catch (e) {
      error.value = (e as ApiErrorPayload) ?? { message: '未知错误' }
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,

    get: <T>(path: string, query?: RequestOptions['query']) =>
      run<T>(path, { method: 'GET', query }),

    post: <T>(path: string, body?: unknown) =>
      run<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),

    put: <T>(path: string, body?: unknown) =>
      run<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),

    del: <T>(path: string) =>
      run<T>(path, { method: 'DELETE' }),

    request: run,
  }
}