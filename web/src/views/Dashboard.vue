<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApi } from '../composables/useApi'

type EventLevel = 'success' | 'warning' | 'info'

interface DashboardEvent {
  time: string
  event: string
  level: EventLevel
  createdAt: string
}

interface DashboardData {
  botStatus: string
  activeChannels: number
  todayMessages: number
  tokenThroughput: number
  events: DashboardEvent[]
  timeZone: string
  since: string
}

const api = useApi()

const loading = ref(false)
const loadError = ref('')
const data = ref<DashboardData | null>(null)
const timerId = ref<number | null>(null)

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatToken(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return String(value)
}

async function loadDashboard() {
  loading.value = true
  loadError.value = ''
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    data.value = await api.get<DashboardData>('/dashboard', {
      eventLimit: 25,
      timeZone: tz,
    })
  } catch (err: any) {
    loadError.value = err?.message || '加载仪表盘失败'
  } finally {
    loading.value = false
  }
}

const kpis = computed(() => [
  {
    label: 'Bot 状态',
    value: data.value?.botStatus ?? '未知',
    badge: data.value?.botStatus === '在线' ? 'success' : 'danger',
  },
  {
    label: '活跃频道',
    value: formatNumber(data.value?.activeChannels ?? 0),
  },
  {
    label: '今日消息',
    value: formatNumber(data.value?.todayMessages ?? 0),
  },
  {
    label: 'Token 吞吐',
    value: formatToken(data.value?.tokenThroughput ?? 0),
  },
])

const events = computed(() => data.value?.events ?? [])

onMounted(async () => {
  await loadDashboard()
  timerId.value = window.setInterval(loadDashboard, 10_000)
})

onBeforeUnmount(() => {
  if (timerId.value !== null) {
    window.clearInterval(timerId.value)
    timerId.value = null
  }
})
</script>

<template>
  <section class="stack">
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">运行态总览</div>
          <div class="panel-subtitle">
            群聊合并式历史 / 流式输出 / 工具迭代追踪
          </div>
        </div>
        <div class="split">
          <span class="kbd" v-if="data">TZ: {{ data.timeZone }}</span>
          <button class="stellar-button ghost" :disabled="loading" @click="loadDashboard">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
          <div class="badge" :class="data?.botStatus === '在线' ? 'success' : 'danger'">
            {{ data?.botStatus === '在线' ? 'LIVE' : 'OFFLINE' }}
          </div>
        </div>
      </div>
      <div class="panel-body">
        <div class="grid-4">
          <article v-for="item in kpis" :key="item.label" class="stat-card">
            <div class="stat-label">{{ item.label }}</div>
            <div class="stat-value">{{ item.value }}</div>
          </article>
        </div>
      </div>
    </div>

    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">最近事件流</div>
          <div class="panel-subtitle">
            实时来自后端统计（消息流 / 回复 / 总结触发）
          </div>
        </div>
        <span class="kbd">Polling 10s</span>
      </div>
      <div class="panel-body">
        <div v-if="loadError" class="badge danger" style="margin-bottom: 8px;">
          {{ loadError }}
        </div>

        <table class="stellar-table">
          <thead>
            <tr>
              <th style="width: 120px;">时间</th>
              <th>事件</th>
              <th style="width: 120px;">级别</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in events" :key="item.createdAt + item.event">
              <td>{{ item.time }}</td>
              <td>{{ item.event }}</td>
              <td>
                <span class="badge" :class="item.level">{{ item.level }}</span>
              </td>
            </tr>
            <tr v-if="events.length === 0">
              <td colspan="3" class="muted">
                暂无事件数据
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>