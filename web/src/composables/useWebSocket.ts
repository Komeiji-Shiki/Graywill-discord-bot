import { onBeforeUnmount, ref } from 'vue'

export type WsState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface WsMessage<T = unknown> {
  event: string
  data: T
  at?: string
}

export interface UseWebSocketOptions {
  autoConnect?: boolean
  reconnect?: boolean
  reconnectDelay?: number
  maxReconnectAttempts?: number
}

export function useWebSocket(url = '/ws', options: UseWebSocketOptions = {}) {
  const {
    autoConnect = true,
    reconnect = true,
    reconnectDelay = 1500,
    maxReconnectAttempts = 10,
  } = options

  const state = ref<WsState>('idle')
  const socket = ref<WebSocket | null>(null)
  const lastMessage = ref<WsMessage | null>(null)
  const reconnectAttempts = ref(0)

  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  function emit(event: string, payload: unknown) {
    const set = listeners.get(event)
    if (!set) return
    for (const cb of set) cb(payload)
  }

  function on(event: string, handler: (payload: unknown) => void) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(handler)
    return () => listeners.get(event)?.delete(handler)
  }

  function buildWsUrl(): string {
    if (/^wss?:\/\//.test(url)) return url
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${url}`
  }

  function connect() {
    if (socket.value && (state.value === 'connecting' || state.value === 'open')) return

    state.value = 'connecting'
    const ws = new WebSocket(buildWsUrl())
    socket.value = ws

    ws.onopen = () => {
      state.value = 'open'
      reconnectAttempts.value = 0
      emit('__open__', null)
    }

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as WsMessage
        lastMessage.value = parsed
        emit(parsed.event, parsed.data)
      } catch {
        const fallback: WsMessage<string> = {
          event: 'raw',
          data: String(event.data),
          at: new Date().toISOString(),
        }
        lastMessage.value = fallback
        emit('raw', fallback.data)
      }
    }

    ws.onerror = () => {
      state.value = 'error'
      emit('__error__', null)
    }

    ws.onclose = () => {
      state.value = 'closed'
      emit('__close__', null)

      if (!reconnect) return
      if (reconnectAttempts.value >= maxReconnectAttempts) return

      reconnectAttempts.value += 1
      window.setTimeout(connect, reconnectDelay)
    }
  }

  function close() {
    reconnectAttempts.value = maxReconnectAttempts
    socket.value?.close()
  }

  function send(event: string, data: unknown) {
    if (state.value !== 'open' || !socket.value) return false
    socket.value.send(JSON.stringify({ event, data }))
    return true
  }

  if (autoConnect) connect()

  onBeforeUnmount(() => {
    close()
  })

  return {
    state,
    socket,
    lastMessage,
    reconnectAttempts,
    connect,
    close,
    send,
    on,
  }
}