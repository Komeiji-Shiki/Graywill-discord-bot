<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

interface ChannelOption {
  id: string
  name: string
  timeZone: string
}

interface SessionOption {
  sessionId: string
  messageCount: number
  lastMessageAt: string | null
}

interface EndpointOption {
  id: string
  name: string
  model: string
}

interface SummaryItem {
  id: number
  channelId: string
  summary: string
  tokenCount: number
  coversFrom: string | null
  coversTo: string | null
  messageCount: number
  createdAt: string
}

interface SummaryConfig {
  summaryThreshold: number
  summarySystemPrompt: string
  summaryUserPrompt: string
  summaryEndpointId: string | null
  summaryTemperature: number
  summaryMaxTokens: number
}

const DEFAULT_SYSTEM_PROMPT =
  '你是对话压缩器。请将群聊对话压缩为可长期记忆的摘要：保留事实、关系、偏好、待办、约定、关键上下文；必须保留每段对话发生的时间（日期和时间段）；避免废话；使用中文。'

const DEFAULT_USER_PROMPT = [
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

const api = useApi()
const toast = useToast()

const loadingChannels = ref(false)
const loadingDetail = ref(false)
const saving = ref(false)
const triggering = ref(false)
const exporting = ref(false)
const importing = ref(false)
const resummarizingIds = ref<number[]>([])

const channels = ref<ChannelOption[]>([])
const endpoints = ref<EndpointOption[]>([])
const sessions = ref<SessionOption[]>([])
const activeChannelId = ref('')
const activeSessionId = ref('')
const summaries = ref<SummaryItem[]>([])
const selectedSummaryIds = ref<number[]>([])
const importSummaryText = ref('')
const importFileInput = ref<HTMLInputElement | null>(null)

// 总结配置
const config = ref<SummaryConfig>({
  summaryThreshold: 6000,
  summarySystemPrompt: '',
  summaryUserPrompt: '',
  summaryEndpointId: null,
  summaryTemperature: 0.2,
  summaryMaxTokens: 1024,
})

// 编辑中的总结
const editingId = ref<number | null>(null)
const editContent = ref('')

// 活跃 tab
type ActiveTab = 'list' | 'config'
const activeTab = ref<ActiveTab>('list')

const activeChannel = computed(
  () => channels.value.find((c) => c.id === activeChannelId.value) ?? null
)

const selectedCount = computed(() => selectedSummaryIds.value.length)
const allSelected = computed(() =>
  summaries.value.length > 0 &&
  summaries.value.every((s) => selectedSummaryIds.value.includes(s.id))
)

function toChannelName(x: any): string {
  const name = String(x?.channelName ?? '').trim()
  return name || String(x?.channelId ?? '')
}

function formatIsoInTimeZone(iso?: string | null, timeZone = 'Asia/Shanghai'): string {
  const raw = String(iso ?? '').trim()
  if (!raw) return ''

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value
      return acc
    }, {})

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

function formatRange(from?: string | null, to?: string | null, timeZone = 'Asia/Shanghai'): string {
  const f = formatIsoInTimeZone(from, timeZone) || '未知'
  const t = formatIsoInTimeZone(to, timeZone) || '未知'
  return `${f} ~ ${t}`
}

function formatDate(iso: string, timeZone = 'Asia/Shanghai'): string {
  return formatIsoInTimeZone(iso, timeZone)
}

function buildExportFileName(channelId: string, sessionId: string, count: number): string {
  const safeChannel = String(channelId || 'channel').replace(/[^\w-]+/g, '_')
  const safeSession = String(sessionId || 'all').replace(/[^\w-]+/g, '_')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `summaries-${safeChannel}-${safeSession}-${count}-${stamp}.json`
}

function parseImportedSummaryText(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''

  // 纯文本直接当作大总结
  if (!(text.startsWith('{') || text.startsWith('['))) return text

  try {
    const parsed = JSON.parse(text) as any
    if (typeof parsed?.summary === 'string' && parsed.summary.trim()) {
      return parsed.summary.trim()
    }
    if (typeof parsed?.mergedSummary === 'string' && parsed.mergedSummary.trim()) {
      return parsed.mergedSummary.trim()
    }
    if (typeof parsed?.content === 'string' && parsed.content.trim()) {
      return parsed.content.trim()
    }

    if (Array.isArray(parsed?.summaries)) {
      const merged = parsed.summaries
        .map((x: any) => String(x?.summary ?? '').trim())
        .filter(Boolean)
        .join('\n\n')
      return merged.trim()
    }

    if (Array.isArray(parsed)) {
      const merged = parsed
        .map((x: any) => String(x?.summary ?? x?.content ?? '').trim())
        .filter(Boolean)
        .join('\n\n')
      return merged.trim()
    }
  } catch {
    // 不是合法 JSON，回退为纯文本
  }

  return text
}

// 获取 system prompt 显示文本
const displaySystemPrompt = computed(() =>
  config.value.summarySystemPrompt.trim() || DEFAULT_SYSTEM_PROMPT
)

const displayUserPrompt = computed(() =>
  config.value.summaryUserPrompt.trim() || DEFAULT_USER_PROMPT
)

async function loadChannels() {
  loadingChannels.value = true
  try {
    const [channelRows, endpointRows, summaryCfg] = await Promise.all([
      api.get<any[]>('/channels'),
      api.get<any[]>('/endpoints'),
      api.get<any>('/summary-config'),
    ])
    channels.value = channelRows.map((x) => ({
      id: String(x.channelId),
      name: toChannelName(x),
      timeZone: String(x?.timeZone ?? 'Asia/Shanghai'),
    }))
    endpoints.value = endpointRows.map((x) => ({
      id: String(x.id),
      name: String(x.name),
      model: String(x.model),
    }))

    // 全局总结配置（所有频道/会话共享）
    const rawSystem = String(summaryCfg?.summarySystemPrompt ?? '').trim()
    const rawUser = String(summaryCfg?.summaryUserPrompt ?? '').trim()
    config.value = {
      summaryThreshold: Number(summaryCfg?.summaryThreshold ?? 6000),
      summarySystemPrompt: rawSystem || DEFAULT_SYSTEM_PROMPT,
      summaryUserPrompt: rawUser || DEFAULT_USER_PROMPT,
      summaryEndpointId: summaryCfg?.summaryEndpointId ?? null,
      summaryTemperature: Number(summaryCfg?.summaryTemperature ?? 0.2),
      summaryMaxTokens: Number(summaryCfg?.summaryMaxTokens ?? 1024),
    }

    if (channels.value.length > 0 && !channels.value.some((c) => c.id === activeChannelId.value)) {
      activeChannelId.value = channels.value[0].id
    }
  } catch (err: any) {
    toast.error(err?.message || '加载频道失败')
  } finally {
    loadingChannels.value = false
  }
}

async function loadSessions(channelId: string) {
  if (!channelId) return
  try {
    const data = await api.get<any>(`/sessions/${channelId}`)
    sessions.value = (data?.sessions || []).map((s: any) => ({
      sessionId: String(s?.sessionId ?? 'default'),
      messageCount: Number(s?.messageCount ?? 0),
      lastMessageAt: s?.lastMessageAt ?? null,
    }))
    const active = String(data?.activeSessionId ?? 'default')
    // 如果当前选中的 session 不在列表中，切换到活跃 session
    if (!sessions.value.some((s) => s.sessionId === activeSessionId.value)) {
      activeSessionId.value = active
    }
  } catch {
    sessions.value = []
  }
}

async function loadDetail(channelId: string, sessionId?: string) {
  if (!channelId) return
  loadingDetail.value = true
  editingId.value = null
  const sessionQuery = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  try {
    const summaryRows = await api.get<any[]>(`/summaries/${channelId}${sessionQuery}`)
    summaries.value = (summaryRows || []).map((x) => ({
      id: Number(x?.id ?? 0),
      channelId: String(x?.channelId ?? ''),
      summary: String(x?.summary ?? ''),
      tokenCount: Number(x?.tokenCount ?? 0),
      coversFrom: x?.coversFrom ?? null,
      coversTo: x?.coversTo ?? null,
      messageCount: Number(x?.messageCount ?? 0),
      createdAt: String(x?.createdAt ?? ''),
    }))
  } catch (err: any) {
    toast.error(err?.message || '加载总结失败')
  } finally {
    loadingDetail.value = false
  }
}

watch(activeChannelId, async (id) => {
  if (id) {
    await loadSessions(id)
    await loadDetail(id, activeSessionId.value || undefined)
  }
})

watch(activeSessionId, (sid) => {
  if (activeChannelId.value) {
    loadDetail(activeChannelId.value, sid || undefined)
  }
})

watch(summaries, (rows) => {
  const valid = new Set(rows.map((x) => x.id))
  selectedSummaryIds.value = selectedSummaryIds.value.filter((id) => valid.has(id))
})

// ─── 总结操作 ───

function startEdit(item: SummaryItem) {
  editingId.value = item.id
  editContent.value = item.summary
}

function cancelEdit() {
  editingId.value = null
  editContent.value = ''
}

async function saveEdit() {
  if (editingId.value === null) return
  try {
    await api.put(`/summaries/${editingId.value}`, {
      summary: editContent.value,
    })
    toast.success('总结已更新')
    editingId.value = null
    await loadDetail(activeChannelId.value, activeSessionId.value || undefined)
  } catch (err: any) {
    toast.error(err?.message || '更新总结失败')
  }
}

async function deleteSummary(item: SummaryItem) {
  if (!confirm(`确认删除该总结（${item.messageCount} 条消息）？`)) return
  try {
    await api.del(`/summaries/${item.id}`)
    toast.success('总结已删除')
    await loadDetail(activeChannelId.value, activeSessionId.value || undefined)
  } catch (err: any) {
    toast.error(err?.message || '删除总结失败')
  }
}

async function triggerSummaryNow() {
  if (!activeChannelId.value) return
  triggering.value = true
  try {
    const data = await api.post<any>(`/summaries/${activeChannelId.value}/trigger`, {
      sessionId: activeSessionId.value || undefined,
    })
    if (data?.created && data?.summary) {
      const s = data.summary
      toast.success(`总结完成：${s.messageCount} 条消息 → ${s.tokenCount} tokens`)
    } else {
      toast.info('当前会话没有可总结的消息')
    }
    await loadDetail(activeChannelId.value, activeSessionId.value || undefined)
  } catch (err: any) {
    toast.error(err?.message || '手动总结失败')
  } finally {
    triggering.value = false
  }
}

// ─── 配置保存 ───

function isResummarizing(id: number): boolean {
  return resummarizingIds.value.includes(id)
}

async function resummarizeSummary(item: SummaryItem) {
  if (!activeChannelId.value) return
  if (isResummarizing(item.id)) return
  if (!confirm(`确认重新总结该区间（${formatRange(item.coversFrom, item.coversTo)}）？`)) return

  resummarizingIds.value = [...resummarizingIds.value, item.id]
  try {
    const data = await api.post<any>(`/summaries/${item.id}/resummarize`)
    const updated = data?.summary
    const rangeCount = Number(data?.rangeMessageCount ?? item.messageCount ?? 0)
    const tokenCount = Number(updated?.tokenCount ?? item.tokenCount ?? 0)
    toast.success(`重总结完成：${rangeCount} 条消息 → ${tokenCount} tokens`)
    await loadDetail(activeChannelId.value, activeSessionId.value || undefined)
  } catch (err: any) {
    toast.error(err?.message || '重总结失败')
  } finally {
    resummarizingIds.value = resummarizingIds.value.filter((x) => x !== item.id)
  }
}

function onToggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedSummaryIds.value = checked ? summaries.value.map((s) => s.id) : []
}

async function exportSelectedSummaries() {
  if (!activeChannelId.value) return
  if (selectedSummaryIds.value.length === 0) {
    toast.info('请先勾选至少一条总结')
    return
  }

  exporting.value = true
  try {
    const data = await api.post<any>(`/summaries/${activeChannelId.value}/export`, {
      sessionId: activeSessionId.value || undefined,
      ids: selectedSummaryIds.value,
    })

    const payloadText = JSON.stringify(data, null, 2)
    const blob = new Blob([payloadText], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const filename = buildExportFileName(
      activeChannelId.value,
      activeSessionId.value || 'all',
      Number(data?.count ?? selectedSummaryIds.value.length)
    )

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success(`已导出 ${Number(data?.count ?? selectedSummaryIds.value.length)} 条总结`)
  } catch (err: any) {
    toast.error(err?.message || '批量导出失败')
  } finally {
    exporting.value = false
  }
}

function pickImportFile() {
  importFileInput.value?.click()
}

async function onImportFileChanged(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const raw = await file.text()
    const parsed = parseImportedSummaryText(raw)
    if (!parsed) {
      toast.error('文件中未解析到可用总结内容')
      return
    }
    importSummaryText.value = parsed
    toast.success(`已载入文件：${file.name}`)
  } catch (err: any) {
    toast.error(err?.message || '读取导入文件失败')
  } finally {
    input.value = ''
  }
}

async function importMergeSelectedSummaries() {
  if (!activeChannelId.value) return
  if (selectedSummaryIds.value.length === 0) {
    toast.info('请先勾选要被覆盖的总结')
    return
  }

  const summary = importSummaryText.value.trim()
  if (!summary) {
    toast.info('请先粘贴或导入“大总结”文本')
    return
  }

  if (!confirm(`确认用当前大总结覆盖这 ${selectedSummaryIds.value.length} 条总结吗？`)) return

  importing.value = true
  try {
    const data = await api.post<any>(`/summaries/${activeChannelId.value}/import-merge`, {
      sessionId: activeSessionId.value || undefined,
      replaceIds: selectedSummaryIds.value,
      summary,
    })

    const replacedCount = Number(data?.replacedCount ?? selectedSummaryIds.value.length)
    toast.success(`导入覆盖完成：已替换 ${replacedCount} 条总结`)
    selectedSummaryIds.value = []
    await loadDetail(activeChannelId.value, activeSessionId.value || undefined)
  } catch (err: any) {
    toast.error(err?.message || '导入覆盖失败')
  } finally {
    importing.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    await api.put('/summary-config', {
      summaryThreshold: config.value.summaryThreshold,
      summarySystemPrompt: config.value.summarySystemPrompt,
      summaryUserPrompt: config.value.summaryUserPrompt,
      summaryEndpointId: config.value.summaryEndpointId || null,
      summaryTemperature: config.value.summaryTemperature,
      summaryMaxTokens: config.value.summaryMaxTokens,
    })
    toast.success('全局总结配置已保存')
  } catch (err: any) {
    toast.error(err?.message || '保存配置失败')
  } finally {
    saving.value = false
  }
}

function resetToDefaults() {
  config.value.summarySystemPrompt = DEFAULT_SYSTEM_PROMPT
  config.value.summaryUserPrompt = DEFAULT_USER_PROMPT
  config.value.summaryTemperature = 0.2
  config.value.summaryMaxTokens = 1024
  config.value.summaryEndpointId = null
  toast.info('已重置为默认值（需保存才能生效）')
}

const stats = computed(() => ({
  total: summaries.value.length,
  totalTokens: summaries.value.reduce((acc, s) => acc + s.tokenCount, 0),
  totalMessages: summaries.value.reduce((acc, s) => acc + s.messageCount, 0),
}))

onMounted(async () => {
  await loadChannels()
  if (activeChannelId.value) {
    await loadSessions(activeChannelId.value)
    await loadDetail(activeChannelId.value, activeSessionId.value || undefined)
  }
})
</script>

<template>
  <section class="stack">
    <!-- 顶部控制栏 -->
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">总结管理</div>
          <div class="panel-subtitle">查看/编辑/删除对话总结；总结配置为全局共享（所有频道/会话共用）</div>
        </div>
        <div class="split">
          <label class="stack" style="min-width: 180px;">
            <span class="muted">频道</span>
            <select class="stellar-select" v-model="activeChannelId">
              <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label class="stack" style="min-width: 140px;" v-if="sessions.length > 0">
            <span class="muted">会话</span>
            <select class="stellar-select" v-model="activeSessionId">
              <option value="">全部会话</option>
              <option v-for="s in sessions" :key="s.sessionId" :value="s.sessionId">
                {{ s.sessionId }} ({{ s.messageCount }}条)
              </option>
            </select>
          </label>
          <button
            class="stellar-button"
            :disabled="triggering || !activeChannelId"
            @click="triggerSummaryNow"
          >
            {{ triggering ? '总结中...' : '立即总结' }}
          </button>
          <button class="stellar-button ghost" :disabled="loadingChannels" @click="loadChannels">
            {{ loadingChannels ? '刷新中...' : '刷新' }}
          </button>
        </div>
      </div>

      <div class="panel-body">
        <div class="split" style="flex-wrap: wrap;">
          <template v-if="activeChannel">
            <span class="badge">{{ activeChannel.name }}</span>
            <span class="badge warning">{{ stats.total }} 条总结</span>
            <span class="badge">{{ stats.totalTokens }} tokens</span>
            <span class="badge success">覆盖 {{ stats.totalMessages }} 条消息</span>
          </template>
          <template v-else>
            <span class="muted">暂无频道，可先配置全局总结参数</span>
          </template>
          <div style="flex: 1;"></div>
          <div class="split" style="gap: 6px;">
            <button
              class="nav-item"
              style="max-width: 100px; text-align: center; padding: 6px 12px;"
              :class="{ 'router-link-active': activeTab === 'list' }"
              @click="activeTab = 'list'"
            >
              总结列表
            </button>
            <button
              class="nav-item"
              style="max-width: 100px; text-align: center; padding: 6px 12px;"
              :class="{ 'router-link-active': activeTab === 'config' }"
              @click="activeTab = 'config'"
            >
              总结配置
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB: 总结列表 -->
    <div class="stellar-panel" v-if="activeChannel && activeTab === 'list'">
      <div class="panel-header">
        <div>
          <div class="panel-title">总结压缩记录</div>
          <div class="panel-subtitle">支持多选批量导出；可导入一个大总结覆盖选中总结</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="split batch-toolbar">
          <label class="split" style="gap: 6px; align-items: center;">
            <input
              type="checkbox"
              :checked="allSelected"
              :disabled="summaries.length === 0"
              @change="onToggleSelectAll"
            />
            <span class="muted">全选当前列表</span>
          </label>
          <span class="muted">已选择 {{ selectedCount }} 条</span>
          <div style="flex: 1;"></div>
          <input
            ref="importFileInput"
            type="file"
            accept=".txt,.md,.json,.text"
            style="display: none;"
            @change="onImportFileChanged"
          />
          <button
            class="stellar-button ghost"
            :disabled="exporting || selectedCount === 0"
            @click="exportSelectedSummaries"
          >
            {{ exporting ? '导出中...' : '导出选中' }}
          </button>
          <button class="stellar-button ghost" :disabled="importing" @click="pickImportFile">
            读取文件
          </button>
        </div>

        <label class="stack import-box">
          <span class="muted">导入大总结文本（将覆盖当前勾选的总结）</span>
          <textarea
            class="stellar-textarea"
            v-model="importSummaryText"
            rows="4"
            placeholder="可直接粘贴总结文本；或点上方“读取文件”加载 .txt/.md/.json"
          />
          <div class="split" style="gap: 8px; align-items: center;">
            <span class="muted" style="font-size: 11px;">
              JSON 支持字段：summary / mergedSummary / content（或 export 文件的 summaries）
            </span>
            <div style="flex: 1;"></div>
            <button
              class="stellar-button danger"
              :disabled="importing || selectedCount === 0 || !importSummaryText.trim()"
              @click="importMergeSelectedSummaries"
            >
              {{ importing ? '导入覆盖中...' : '导入覆盖选中' }}
            </button>
          </div>
        </label>

        <div class="summary-table-wrap">
          <table class="stellar-table">
            <thead>
              <tr>
                <th style="width: 42px;">选</th>
                <th style="width: 50px;">#</th>
                <th style="width: 200px;">覆盖区间</th>
                <th>总结内容</th>
                <th style="width: 60px;">消息数</th>
                <th style="width: 60px;">Token</th>
                <th style="width: 140px;">生成时间</th>
                <th style="width: 180px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in summaries" :key="item.id">
                <td>
                  <input type="checkbox" :value="item.id" v-model="selectedSummaryIds" />
                </td>
                <td class="muted">{{ item.id }}</td>
                <td class="muted" style="font-size: 11px;">
                  {{ formatRange(item.coversFrom, item.coversTo, activeChannel?.timeZone || 'Asia/Shanghai') }}
                </td>
                <td>
                  <!-- 编辑模式 -->
                  <template v-if="editingId === item.id">
                    <div class="stack" style="gap: 6px;">
                      <textarea
                        class="stellar-textarea"
                        v-model="editContent"
                        rows="6"
                        style="font-size: 12px;"
                      />
                      <div class="split" style="gap: 6px;">
                        <button class="stellar-button" @click="saveEdit" style="padding: 4px 10px;">保存</button>
                        <button class="stellar-button ghost" @click="cancelEdit" style="padding: 4px 10px;">取消</button>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <span
                      class="summary-text"
                      @click="startEdit(item)"
                      :title="item.summary"
                    >
                      {{ item.summary.length > 300 ? item.summary.slice(0, 300) + '...' : item.summary }}
                    </span>
                  </template>
                </td>
                <td>{{ item.messageCount }}</td>
                <td>{{ item.tokenCount }}</td>
                <td class="muted" style="font-size: 11px;">{{ formatDate(item.createdAt, activeChannel?.timeZone || 'Asia/Shanghai') }}</td>
                <td>
                  <div class="split" style="gap: 4px; flex-wrap: wrap;">
                    <button
                      v-if="editingId !== item.id"
                      class="stellar-button ghost"
                      style="padding: 2px 8px; font-size: 11px;"
                      @click="startEdit(item)"
                    >
                      编辑
                    </button>
                    <button
                      class="stellar-button ghost"
                      style="padding: 2px 8px; font-size: 11px;"
                      :disabled="isResummarizing(item.id)"
                      @click="resummarizeSummary(item)"
                    >
                      {{ isResummarizing(item.id) ? '重总结中...' : '重新总结' }}
                    </button>
                    <button
                      class="stellar-button danger"
                      style="padding: 2px 8px; font-size: 11px;"
                      @click="deleteSummary(item)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="summaries.length === 0">
                <td colspan="8" class="muted">当前频道暂无总结记录</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB: 总结配置 -->
    <div class="stellar-panel" v-if="activeTab === 'config'">
      <div class="panel-header">
        <div>
          <div class="panel-title">总结配置（全局）</div>
          <div class="panel-subtitle">所有频道/会话共用这一份总结提示词、模型与参数（留空使用默认值）</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost" @click="resetToDefaults">重置默认</button>
          <button class="stellar-button" :disabled="saving" @click="saveConfig">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
      <div class="panel-body stack">
        <div class="grid-2">
          <label class="stack">
            <span class="muted">总结触发阈值（tokens）</span>
            <input class="stellar-input" type="number" v-model.number="config.summaryThreshold" />
            <span class="muted" style="font-size: 11px;">
              未被总结的消息累计 token 超过此值时触发自动总结
            </span>
          </label>

          <label class="stack">
            <span class="muted">总结专用端点</span>
            <select class="stellar-select" v-model="config.summaryEndpointId">
              <option :value="null">（使用频道主端点）</option>
              <option
                v-for="ep in endpoints"
                :key="ep.id"
                :value="ep.id"
              >
                {{ ep.name }} · {{ ep.model }}
              </option>
            </select>
            <span class="muted" style="font-size: 11px;">
              可指定一个便宜/快速的模型专门用于总结，留空则复用当前频道主端点
            </span>
          </label>

          <label class="stack">
            <span class="muted">温度（temperature）</span>
            <input class="stellar-input" type="number" step="0.05" v-model.number="config.summaryTemperature" />
          </label>

          <label class="stack">
            <span class="muted">最大输出 tokens</span>
            <input class="stellar-input" type="number" v-model.number="config.summaryMaxTokens" />
            <span class="muted" style="font-size: 11px;">
              设为 0 时自动使用端点 maxTokens × 0.6
            </span>
          </label>
        </div>

        <label class="stack">
          <span class="muted">System 提示词</span>
          <textarea
            class="stellar-textarea"
            v-model="config.summarySystemPrompt"
            rows="4"
          />
          <span class="muted" style="font-size: 11px;">
            发送给 LLM 的 role:system 消息。点击「重置默认」可还原。
          </span>
        </label>

        <label class="stack">
          <span class="muted">User 提示词模板</span>
          <textarea
            class="stellar-textarea"
            v-model="config.summaryUserPrompt"
            rows="8"
          />
          <span class="muted" style="font-size: 11px;">
            <code v-pre>{{chatLog}}</code> 会被替换为格式化的聊天记录。点击「重置默认」可还原。
          </span>
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.batch-toolbar {
  margin-bottom: 10px;
  gap: 10px;
  flex-wrap: wrap;
}

.import-box {
  margin-bottom: 12px;
}

.summary-table-wrap {
  max-height: 600px;
  overflow: auto;
}

.summary-text {
  cursor: pointer;
  word-break: break-all;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.5;
}

.summary-text:hover {
  color: var(--accent, #6ec1e4);
}

.preview-text {
  margin: 6px 0 0;
  padding: 8px 12px;
  background: var(--bg, rgba(0,0,0,0.1));
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted, #999);
  max-height: 200px;
  overflow-y: auto;
}
</style>