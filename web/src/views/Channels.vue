<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

type TriggerMode = 'mention' | 'keyword' | 'all' | 'command' | 'dm'

interface ChannelConfigRecord {
  channelId: string
  guildId: string | null
  channelName: string | null
  enabled: boolean
  endpointId: string | null
  presetId: string | null
  characterId: string | null
  triggerMode: TriggerMode
  maxHistoryTokens: number
  historyMessageLimit: number
  timeZone: string
  silenceThreshold: number
  toolsEnabled: boolean
  maxToolIterations: number
  historyInsertAt: string
  assistantPrefill: string
  worldbookInlineJson: string
  customMacrosJson: string
  userDisplayName: string
  createdAt: string
  updatedAt: string
}

interface EndpointOption {
  id: string
  name: string
  model: string
}

interface NamedOption {
  id: string
  name: string
}

interface PresetOption extends NamedOption {
  boundEndpointId: string
}

const api = useApi()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const savingBatch = ref(false)

const endpointOptions = ref<EndpointOption[]>([])
const presetOptions = ref<PresetOption[]>([])
const characterOptions = ref<NamedOption[]>([])
const channels = ref<ChannelConfigRecord[]>([])

const activeId = ref('')
const selectedChannelIds = ref<string[]>([])
const includeEnabledInBatch = ref(false)
const globalSummaryThreshold = ref<number | null>(null)

const active = computed(() => channels.value.find((c) => c.channelId === activeId.value) ?? null)

const activeName = computed(() => {
  const row = active.value
  if (!row) return ''
  if (row.channelName && row.channelName.trim()) return row.channelName
  return row.channelId
})

const globalSummaryThresholdText = computed(() => {
  const n = Number(globalSummaryThreshold.value)
  if (Number.isFinite(n) && n > 0) return `${Math.floor(n)} tokens（全局）`
  return '使用全局总结阈值（在「总结管理」中设置）'
})

const batchTargetIds = computed(() =>
  selectedChannelIds.value.filter(
    (id, idx, arr) =>
      arr.indexOf(id) === idx &&
      id !== activeId.value &&
      channels.value.some((c) => c.channelId === id)
  )
)

const batchTargetCount = computed(() => batchTargetIds.value.length)

function ensureActiveSelection() {
  if (channels.value.length === 0) {
    activeId.value = ''
    return
  }
  if (!channels.value.some((x) => x.channelId === activeId.value)) {
    activeId.value = channels.value[0].channelId
  }
}

function syncSelectedWithChannels() {
  const allowed = new Set(channels.value.map((c) => c.channelId))
  selectedChannelIds.value = selectedChannelIds.value.filter((id) => allowed.has(id))
}

function isChannelSelected(id: string) {
  return selectedChannelIds.value.includes(id)
}

function toggleChannelSelected(id: string) {
  if (isChannelSelected(id)) {
    selectedChannelIds.value = selectedChannelIds.value.filter((x) => x !== id)
  } else {
    selectedChannelIds.value = [...selectedChannelIds.value, id]
  }
}

function selectAllChannels() {
  selectedChannelIds.value = channels.value.map((c) => c.channelId)
}

function clearSelectedChannels() {
  selectedChannelIds.value = []
}

function extractBoundEndpointIdFromPresetData(raw: unknown): string {
  const text = String(raw ?? '').trim()
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

function applyEndpointBoundPreset() {
  if (!active.value) return
  const endpointId = String(active.value.endpointId ?? '').trim()
  if (!endpointId) return

  const matchedPresets = presetOptions.value.filter((x) => x.boundEndpointId === endpointId)
  if (matchedPresets.length === 0) {
    const endpoint = endpointOptions.value.find((x) => x.id === endpointId)
    toast.warning(`该模型端点暂无绑定预设：${endpoint?.name ?? endpointId}`)
    return
  }

  const alreadyMatched = matchedPresets.some((x) => x.id === active.value!.presetId)
  if (alreadyMatched) return

  const targetPreset = matchedPresets[0]
  active.value.presetId = targetPreset.id
  toast.info(`已按模型自动切换预设：${targetPreset.name}`)
}

function onEndpointChange() {
  applyEndpointBoundPreset()
}

async function loadAll() {
  loading.value = true
  try {
    const [channelRows, endpointRows, presetRows, characterRows, summaryCfg] = await Promise.all([
      api.get<ChannelConfigRecord[]>('/channels'),
      api.get<Array<{ id: string; name: string; model: string }>>('/endpoints'),
      api.get<Array<{ id: string; name: string; data?: string }>>('/presets'),
      api.get<Array<{ id: string; name: string }>>('/characters'),
      api.get<{ summaryThreshold?: number }>('/summary-config'),
    ])

    channels.value = channelRows
    syncSelectedWithChannels()
    endpointOptions.value = endpointRows
    presetOptions.value = presetRows.map((x) => ({
      id: x.id,
      name: x.name,
      boundEndpointId: extractBoundEndpointIdFromPresetData(x.data),
    }))
    characterOptions.value = characterRows
    globalSummaryThreshold.value = Number(summaryCfg?.summaryThreshold ?? 0)
    ensureActiveSelection()
  } finally {
    loading.value = false
  }
}

async function toggleChannel(id: string) {
  const item = channels.value.find((c) => c.channelId === id)
  if (!item) return

  const nextEnabled = !item.enabled
  const updated = await api.put<ChannelConfigRecord>(`/channels/${id}`, {
    enabled: nextEnabled,
  })

  const idx = channels.value.findIndex((x) => x.channelId === id)
  if (idx >= 0) channels.value[idx] = updated
}

async function batchApplyFromActive() {
  if (!active.value) return
  if (batchTargetIds.value.length === 0) {
    toast.warning('请先在左侧勾选要批量应用的目标频道')
    return
  }

  savingBatch.value = true
  try {
    const result = await api.post<{
      sourceChannelId: string
      appliedCount: number
      appliedChannelIds: string[]
    }>('/channels/batch-apply', {
      sourceChannelId: active.value.channelId,
      targetChannelIds: batchTargetIds.value,
      includeEnabled: includeEnabledInBatch.value,
    })

    toast.success(`已将配置从源频道应用到 ${result.appliedCount} 个频道`)
    await loadAll()
  } catch (err: any) {
    toast.error(err?.message || '批量应用失败')
  } finally {
    savingBatch.value = false
  }
}

async function saveConfig() {
  if (!active.value) return
  saving.value = true
  try {
    const row = active.value
    const updated = await api.put<ChannelConfigRecord>(`/channels/${row.channelId}`, {
      enabled: row.enabled,
      endpointId: row.endpointId || null,
      presetId: row.presetId || null,
      characterId: row.characterId || null,
      triggerMode: row.triggerMode,
      maxHistoryTokens: row.maxHistoryTokens,
      historyMessageLimit: row.historyMessageLimit,
      timeZone: row.timeZone,
      silenceThreshold: row.silenceThreshold,
      toolsEnabled: row.toolsEnabled,
      maxToolIterations: row.maxToolIterations,
      userDisplayName: row.userDisplayName,
    })
    const idx = channels.value.findIndex((x) => x.channelId === updated.channelId)
    if (idx >= 0) channels.value[idx] = updated
    toast.success('频道配置已保存')
  } catch (err: any) {
    toast.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <section class="grid-2">
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">频道列表</div>
          <div class="panel-subtitle">选择频道并绑定预设 / 角色卡 / 模型端点</div>
        </div>
        <div class="stack" style="justify-items: end; gap: 6px;">
          <button class="stellar-button" :disabled="loading" @click="loadAll">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
          <div class="split" style="gap: 6px; flex-wrap: wrap; justify-content: end;">
            <button class="stellar-button ghost" :disabled="loading || channels.length === 0" @click="selectAllChannels">
              全选
            </button>
            <button class="stellar-button ghost" :disabled="selectedChannelIds.length === 0" @click="clearSelectedChannels">
              清空
            </button>
            <label class="split muted" style="gap: 4px; font-size: 12px;">
              <input type="checkbox" v-model="includeEnabledInBatch" />
              同步启用状态
            </label>
            <button
              class="stellar-button"
              :disabled="savingBatch || !active || batchTargetCount === 0"
              @click="batchApplyFromActive"
            >
              {{ savingBatch ? '应用中...' : `批量应用当前配置（${batchTargetCount}）` }}
            </button>
          </div>
        </div>
      </div>
      <div class="panel-body stack">
        <div
          v-for="item in channels"
          :key="item.channelId"
          class="nav-item"
          :class="{ 'router-link-active': item.channelId === activeId }"
          @click="activeId = item.channelId"
        >
          <div class="split">
            <label class="split" style="gap: 8px; cursor: pointer;" @click.stop>
              <input
                type="checkbox"
                :checked="isChannelSelected(item.channelId)"
                @change="toggleChannelSelected(item.channelId)"
              />
              <span>{{ item.channelName || item.channelId }}</span>
            </label>
            <span class="badge" :class="item.enabled ? 'success' : 'danger'">
              {{ item.enabled ? '启用' : '停用' }}
            </span>
          </div>
          <div class="muted" style="margin-top: 4px; font-size: 11px;">
            {{ item.guildId || 'DM / Unknown Guild' }}
          </div>
        </div>
      </div>
    </div>

    <div class="stellar-panel" v-if="active">
      <div class="panel-header">
        <div>
          <div class="panel-title">频道配置 · {{ activeName }}</div>
          <div class="panel-subtitle">触发策略、全局总结阈值、工具迭代、时间线规则</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost" @click="toggleChannel(active.channelId)">
            {{ active.enabled ? '停用频道' : '启用频道' }}
          </button>
          <button class="stellar-button" :disabled="saving" @click="saveConfig">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>

      <div class="panel-body stack">
        <div class="grid-2">
          <label class="stack">
            <span class="muted">模型端点</span>
            <select class="stellar-select" v-model="active.endpointId" @change="onEndpointChange">
              <option value="">（未绑定）</option>
              <option
                v-for="ep in endpointOptions"
                :key="ep.id"
                :value="ep.id"
              >
                {{ ep.name }} · {{ ep.model }}
              </option>
            </select>
          </label>

          <label class="stack">
            <span class="muted">触发模式</span>
            <select class="stellar-select" v-model="active.triggerMode">
              <option value="mention">mention</option>
              <option value="keyword">keyword</option>
              <option value="all">all</option>
              <option value="command">command</option>
              <option value="dm">dm</option>
            </select>
          </label>

          <label class="stack">
            <span class="muted">预设</span>
            <select class="stellar-select" v-model="active.presetId">
              <option value="">（未绑定）</option>
              <option
                v-for="preset in presetOptions"
                :key="preset.id"
                :value="preset.id"
              >
                {{ preset.name }}
              </option>
            </select>
          </label>

          <label class="stack">
            <span class="muted">角色卡</span>
            <select class="stellar-select" v-model="active.characterId">
              <option value="">（未绑定）</option>
              <option
                v-for="character in characterOptions"
                :key="character.id"
                :value="character.id"
              >
                {{ character.name }}
              </option>
            </select>
          </label>

          <label class="stack">
            <span class="muted">Summary 阈值（全局）</span>
            <input class="stellar-input" type="text" :value="globalSummaryThresholdText" readonly />
          </label>

          <label class="stack">
            <span class="muted">历史上限 Tokens</span>
            <input class="stellar-input" type="number" v-model.number="active.maxHistoryTokens" />
          </label>

          <label class="stack">
            <span class="muted">历史消息条数</span>
            <input
              class="stellar-input"
              type="number"
              min="0"
              step="1"
              v-model.number="active.historyMessageLimit"
              placeholder="0 表示无限"
            />
            <span class="muted" style="font-size: 11px;">
              设为 0 表示不限制条数（会按会话读取全部可用消息）
            </span>
          </label>

          <label class="stack">
            <span class="muted">时区</span>
            <input class="stellar-input" v-model="active.timeZone" />
          </label>

          <label class="stack">
            <span class="muted">沉默阈值（分钟）</span>
            <input class="stellar-input" type="number" v-model.number="active.silenceThreshold" />
          </label>

          <label class="stack">
            <span class="muted">最大工具迭代</span>
            <input class="stellar-input" type="number" v-model.number="active.maxToolIterations" />
          </label>

          <label class="stack">
            <span class="muted">工具调用</span>
            <select class="stellar-select" v-model="active.toolsEnabled">
              <option :value="true">启用</option>
              <option :value="false">禁用</option>
            </select>
          </label>

          <label class="stack">
            <span class="muted">\{\{user\}\} 名称</span>
            <input class="stellar-input" v-model="active.userDisplayName" placeholder="留空则为 User" />
          </label>
        </div>

        <label class="stack">
          <span class="muted">频道说明 / 备注</span>
          <textarea
            class="stellar-textarea"
            placeholder="例如：该频道使用合并式聊天日志，按 mention 触发，输出末尾追加耗时和 token 元数据"
          />
        </label>
      </div>
    </div>
  </section>
</template>