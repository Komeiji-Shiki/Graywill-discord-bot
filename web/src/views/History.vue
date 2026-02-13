<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

type MsgRole = 'user' | 'bot' | 'model' | 'system'

interface MessageRecord {
  id: number
  channelId: string
  messageId: string
  authorId: string
  authorName: string
  content: string
  role: MsgRole
  tokenCount: number
  isBot: boolean
  isSummarized: boolean
  sessionId: string
  createdAt: string
}

interface ChannelOption {
  id: string
  name: string
  activeSessionId: string
}

interface SessionInfo {
  sessionId: string
  messageCount: number
  lastMessageAt: string | null
}

interface SummaryItem {
  id: number
  summary: string
  range: string
  messageCount: number
  tokenCount: number
  createdAt: string
}

const api = useApi()
const toast = useToast()

const loadingChannels = ref(false)
const loadingDetail = ref(false)

const channels = ref<ChannelOption[]>([])
const activeChannelId = ref('')
const sessions = ref<SessionInfo[]>([])
const activeSessionId = ref('default')

const messages = ref<MessageRecord[]>([])
const summaries = ref<SummaryItem[]>([])

// 选中 & 编辑消息
const selectedIds = ref<Set<number>>(new Set())
const editingId = ref<number | null>(null)
const editContent = ref('')
const editRole = ref<MsgRole>('user')

// 总结编辑
const editingSummaryId = ref<number | null>(null)
const editSummaryContent = ref('')

const activeChannel = computed(
  () => channels.value.find((c) => c.id === activeChannelId.value) ?? null
)

const allSelected = computed(() =>
  messages.value.length > 0 && messages.value.every((m) => selectedIds.value.has(m.id))
)

function toChannelName(x: any): string {
  const name = String(x?.channelName ?? '').trim()
  return name || String(x?.channelId ?? '')
}

function formatRange(coversFrom?: string | null, coversTo?: string | null): string {
  const from = coversFrom ? String(coversFrom).slice(0, 10) : '未知'
  const to = coversTo ? String(coversTo).slice(0, 10) : '未知'
  return `${from} ~ ${to}`
}

function roleColor(role: string): string {
  if (role === 'model' || role === 'bot') return 'success'
  if (role === 'system') return 'warning'
  return ''
}

async function loadChannels() {
  loadingChannels.value = true
  try {
    const rows = await api.get<any[]>('/channels')
    channels.value = rows.map((x) => ({
      id: String(x.channelId),
      name: toChannelName(x),
      activeSessionId: String(x.activeSessionId ?? 'default'),
    }))
    if (channels.value.length > 0 && !channels.value.some((x) => x.id === activeChannelId.value)) {
      activeChannelId.value = channels.value[0].id
    }
  } catch (err: any) {
    toast.error(err?.message || '加载频道失败')
  } finally {
    loadingChannels.value = false
  }
}

async function loadSessions(channelId: string) {
  try {
    const data = await api.get<{ activeSessionId: string; sessions: SessionInfo[] }>(`/sessions/${channelId}`)
    sessions.value = data.sessions || []
    activeSessionId.value = data.activeSessionId || 'default'
  } catch {
    sessions.value = []
    activeSessionId.value = 'default'
  }
}

async function loadMessages(channelId: string) {
  if (!channelId) return
  loadingDetail.value = true
  selectedIds.value.clear()
  editingId.value = null
  try {
    const [raw, summaryRows] = await Promise.all([
      api.get<{ messages: MessageRecord[] }>(`/history/${channelId}`, {
        limit: 2000,
        sessionId: activeSessionId.value,
      }),
      api.get<any[]>(`/summaries/${channelId}`),
    ])
    messages.value = raw.messages || []
    summaries.value = (summaryRows || []).map((x) => ({
      id: Number(x?.id ?? 0),
      summary: String(x?.summary ?? ''),
      range: formatRange(x?.coversFrom, x?.coversTo),
      messageCount: Number(x?.messageCount ?? 0),
      tokenCount: Number(x?.tokenCount ?? 0),
      createdAt: String(x?.createdAt ?? ''),
    }))
  } catch (err: any) {
    toast.error(err?.message || '加载历史失败')
  } finally {
    loadingDetail.value = false
  }
}

// 切换频道
watch(activeChannelId, async (id) => {
  if (!id) return
  await loadSessions(id)
  await loadMessages(id)
})

// 切换会话
watch(activeSessionId, async () => {
  if (activeChannelId.value) {
    await loadMessages(activeChannelId.value)
  }
})

// ─── 选择操作 ───

function toggleSelect(id: number) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(messages.value.map((m) => m.id))
  }
}

// ─── 编辑操作 ───

function startEdit(msg: MessageRecord) {
  editingId.value = msg.id
  editContent.value = msg.content
  editRole.value = msg.role
}

function cancelEdit() {
  editingId.value = null
  editContent.value = ''
}

async function saveEdit() {
  if (editingId.value === null) return
  try {
    await api.put(`/history/message/${editingId.value}`, {
      content: editContent.value,
      role: editRole.value,
    })
    toast.success('消息已更新')
    editingId.value = null
    await loadMessages(activeChannelId.value)
  } catch (err: any) {
    toast.error(err?.message || '更新失败')
  }
}

// ─── 删除操作 ───

async function deleteSelected() {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  if (!confirm(`确认删除选中的 ${ids.length} 条消息？`)) return
  try {
    await api.post('/history/messages/delete', { ids })
    toast.success(`已删除 ${ids.length} 条消息`)
    selectedIds.value.clear()
    await loadMessages(activeChannelId.value)
  } catch (err: any) {
    toast.error(err?.message || '删除失败')
  }
}

// ─── 总结编辑操作 ───

function startEditSummary(item: SummaryItem) {
  editingSummaryId.value = item.id
  editSummaryContent.value = item.summary
}

function cancelEditSummary() {
  editingSummaryId.value = null
  editSummaryContent.value = ''
}

async function saveEditSummary() {
  if (editingSummaryId.value === null) return
  try {
    await api.put(`/summaries/${editingSummaryId.value}`, {
      summary: editSummaryContent.value,
    })
    toast.success('总结已更新')
    editingSummaryId.value = null
    await loadMessages(activeChannelId.value)
  } catch (err: any) {
    toast.error(err?.message || '更新总结失败')
  }
}

async function deleteSummary(item: SummaryItem) {
  if (!confirm(`确认删除该总结（${item.range}，${item.messageCount} 条消息）？`)) return
  try {
    await api.del(`/summaries/${item.id}`)
    toast.success('总结已删除')
    await loadMessages(activeChannelId.value)
  } catch (err: any) {
    toast.error(err?.message || '删除总结失败')
  }
}

async function clearHistory() {
  if (!activeChannelId.value) return
  const label = activeSessionId.value === 'default' ? '全部历史' : `会话「${activeSessionId.value}」`
  if (!confirm(`确认清空${label}的所有消息？此操作不可撤销。`)) return
  try {
    await api.del(`/history/${activeChannelId.value}/clear?sessionId=${activeSessionId.value}`)
    toast.success('历史已清空')
    await loadMessages(activeChannelId.value)
  } catch (err: any) {
    toast.error(err?.message || '清空失败')
  }
}

// ─── 会话管理 ───

const newSessionName = ref('')

async function createSession() {
  const name = newSessionName.value.trim()
  if (!name) return
  try {
    await api.post(`/sessions/${activeChannelId.value}/create`, { sessionId: name })
    toast.success(`会话「${name}」已创建并切换`)
    newSessionName.value = ''
    await loadSessions(activeChannelId.value)
    await loadMessages(activeChannelId.value)
  } catch (err: any) {
    toast.error(err?.message || '创建会话失败')
  }
}

async function switchSession(sid: string) {
  try {
    await api.post(`/sessions/${activeChannelId.value}/switch`, { sessionId: sid })
    activeSessionId.value = sid
    toast.success(`已切换到会话「${sid}」`)
    await loadMessages(activeChannelId.value)
  } catch (err: any) {
    toast.error(err?.message || '切换失败')
  }
}

const stats = computed(() => ({
  messages: messages.value.length,
  summaries: summaries.value.length,
  estTokens: messages.value.reduce((acc, m) => acc + (m.tokenCount || 0), 0),
}))

onMounted(async () => {
  await loadChannels()
  if (activeChannelId.value) {
    await loadSessions(activeChannelId.value)
    await loadMessages(activeChannelId.value)
  }
})
</script>

<template>
  <section class="stack">
    <!-- 顶部控制栏 -->
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">聊天历史</div>
          <div class="panel-subtitle">按频道/会话查看、编辑、多选删除消息</div>
        </div>
        <div class="split">
          <label class="stack" style="min-width: 180px;">
            <span class="muted">频道</span>
            <select class="stellar-select" v-model="activeChannelId">
              <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label class="stack" style="min-width: 140px;">
            <span class="muted">会话</span>
            <select class="stellar-select" v-model="activeSessionId">
              <option value="default">default</option>
              <option
                v-for="s in sessions.filter(x => x.sessionId !== 'default')"
                :key="s.sessionId"
                :value="s.sessionId"
              >
                {{ s.sessionId }} ({{ s.messageCount }})
              </option>
            </select>
          </label>
          <button class="stellar-button ghost" :disabled="loadingChannels" @click="loadChannels">
            {{ loadingChannels ? '刷新中...' : '刷新' }}
          </button>
        </div>
      </div>

      <div class="panel-body stack" v-if="activeChannel">
        <!-- 会话管理 -->
        <div class="split" style="flex-wrap: wrap;">
          <span class="badge">{{ activeChannel.name }}</span>
          <span class="badge">{{ stats.messages }} msgs</span>
          <span class="badge warning">{{ stats.estTokens }} tokens</span>
          <span class="badge success">session: {{ activeSessionId }}</span>
          <div style="flex: 1;"></div>
          <div class="split" style="gap: 4px;">
            <input
              class="stellar-input"
              v-model="newSessionName"
              placeholder="新会话名"
              style="width: 120px;"
              @keyup.enter="createSession"
            />
            <button class="stellar-button ghost" :disabled="!newSessionName.trim()" @click="createSession">
              新建会话
            </button>
          </div>
        </div>

        <!-- 会话列表 -->
        <div v-if="sessions.length > 1" class="split" style="flex-wrap: wrap; gap: 4px;">
          <button
            v-for="s in sessions"
            :key="s.sessionId"
            class="badge"
            :class="s.sessionId === activeSessionId ? 'success' : ''"
            style="cursor: pointer;"
            @click="switchSession(s.sessionId)"
          >
            {{ s.sessionId }} ({{ s.messageCount }})
          </button>
        </div>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="stellar-panel" v-if="activeChannel">
      <div class="panel-header">
        <div>
          <div class="panel-title">消息列表</div>
          <div class="panel-subtitle">点击消息编辑，勾选后批量删除</div>
        </div>
        <div class="split">
          <button
            class="stellar-button danger"
            :disabled="selectedIds.size === 0"
            @click="deleteSelected"
          >
            删除选中 ({{ selectedIds.size }})
          </button>
          <button class="stellar-button danger" @click="clearHistory">
            清空全部
          </button>
        </div>
      </div>

      <div class="panel-body">
        <div class="msg-table-wrap">
          <table class="stellar-table">
            <thead>
              <tr>
                <th style="width: 40px;">
                  <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
                </th>
                <th style="width: 50px;">#</th>
                <th style="width: 80px;">Role</th>
                <th style="width: 120px;">Author</th>
                <th>Content</th>
                <th style="width: 60px;">Tokens</th>
                <th style="width: 80px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="msg in messages" :key="msg.id">
                <td>
                  <input
                    type="checkbox"
                    :checked="selectedIds.has(msg.id)"
                    @change="toggleSelect(msg.id)"
                  />
                </td>
                <td class="muted">{{ msg.id }}</td>
                <td>
                  <span class="badge" :class="roleColor(msg.role)">{{ msg.role }}</span>
                </td>
                <td>{{ msg.authorName }}</td>
                <td>
                  <!-- 编辑模式 -->
                  <template v-if="editingId === msg.id">
                    <div class="stack" style="gap: 6px;">
                      <div class="split" style="gap: 6px;">
                        <select class="stellar-select" v-model="editRole" style="width: 100px;">
                          <option value="user">user</option>
                          <option value="bot">bot</option>
                          <option value="model">model</option>
                          <option value="system">system</option>
                        </select>
                        <button class="stellar-button" @click="saveEdit" style="padding: 4px 10px;">保存</button>
                        <button class="stellar-button ghost" @click="cancelEdit" style="padding: 4px 10px;">取消</button>
                      </div>
                      <textarea
                        class="stellar-textarea"
                        v-model="editContent"
                        rows="3"
                        style="font-size: 12px;"
                      />
                    </div>
                  </template>
                  <template v-else>
                    <span
                      style="cursor: pointer; word-break: break-all;"
                      @click="startEdit(msg)"
                      :title="msg.content"
                    >
                      {{ msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content }}
                    </span>
                  </template>
                </td>
                <td class="muted">{{ msg.tokenCount }}</td>
                <td>
                  <button
                    v-if="editingId !== msg.id"
                    class="stellar-button ghost"
                    style="padding: 2px 8px; font-size: 11px;"
                    @click="startEdit(msg)"
                  >
                    编辑
                  </button>
                </td>
              </tr>
              <tr v-if="messages.length === 0">
                <td colspan="7" class="muted">当前无消息记录</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 总结压缩记录 -->
    <div class="stellar-panel" v-if="activeChannel">
      <div class="panel-header">
        <div>
          <div class="panel-title">总结压缩记录</div>
          <div class="panel-subtitle">点击总结内容可编辑，作为独立 Prompt 条目发送给模型</div>
        </div>
      </div>
      <div class="panel-body">
        <table class="stellar-table">
          <thead>
            <tr>
              <th style="width: 130px;">覆盖区间</th>
              <th>总结内容</th>
              <th style="width: 60px;">消息数</th>
              <th style="width: 60px;">Token</th>
              <th style="width: 140px;">生成时间</th>
              <th style="width: 100px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in summaries" :key="item.id">
              <td>{{ item.range }}</td>
              <td>
                <!-- 总结编辑模式 -->
                <template v-if="editingSummaryId === item.id">
                  <div class="stack" style="gap: 6px;">
                    <textarea
                      class="stellar-textarea"
                      v-model="editSummaryContent"
                      rows="5"
                      style="font-size: 12px;"
                    />
                    <div class="split" style="gap: 6px;">
                      <button class="stellar-button" @click="saveEditSummary" style="padding: 4px 10px;">保存</button>
                      <button class="stellar-button ghost" @click="cancelEditSummary" style="padding: 4px 10px;">取消</button>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <span
                    style="cursor: pointer; word-break: break-all; white-space: pre-wrap; font-size: 12px; line-height: 1.5;"
                    @click="startEditSummary(item)"
                    :title="item.summary"
                  >
                    {{ item.summary.length > 300 ? item.summary.slice(0, 300) + '...' : item.summary }}
                  </span>
                </template>
              </td>
              <td>{{ item.messageCount }}</td>
              <td>{{ item.tokenCount }}</td>
              <td class="muted" style="font-size: 11px;">{{ item.createdAt }}</td>
              <td>
                <div class="split" style="gap: 4px;">
                  <button
                    v-if="editingSummaryId !== item.id"
                    class="stellar-button ghost"
                    style="padding: 2px 8px; font-size: 11px;"
                    @click="startEditSummary(item)"
                  >
                    编辑
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
              <td colspan="6" class="muted">当前频道暂无总结记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.msg-table-wrap {
  max-height: 520px;
  overflow: auto;
}
</style>