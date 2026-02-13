<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

interface MacroEntry {
  key: string
  value: string
  description: string
  source: 'system' | 'custom'
}

interface MacrosResponse {
  channelId: string
  macroCount: number
  macros: MacroEntry[]
}

interface ChannelInfo {
  channelId: string
  channelName: string | null
}

const api = useApi()
const toast = useToast()

const channels = ref<ChannelInfo[]>([])
const channelId = ref('')
const macros = ref<MacroEntry[]>([])
const loaded = ref(false)
const searchQuery = ref('')
const filterSource = ref<'all' | 'system' | 'custom'>('all')

const filteredMacros = computed(() => {
  let result = macros.value

  if (filterSource.value !== 'all') {
    result = result.filter((m) => m.source === filterSource.value)
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        m.value.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    )
  }

  return result
})

const systemCount = computed(() => macros.value.filter((m) => m.source === 'system').length)
const customCount = computed(() => macros.value.filter((m) => m.source === 'custom').length)

async function loadChannels() {
  try {
    const data = await api.get<ChannelInfo[]>('/channels')
    channels.value = data
    if (data.length > 0 && !channelId.value) {
      channelId.value = data[0].channelId
      await loadMacros()
    }
  } catch (err: any) {
    toast.error(err?.message || '加载频道列表失败')
  }
}

async function loadMacros() {
  if (!channelId.value.trim()) {
    toast.warning('请先选择或输入频道 ID')
    return
  }

  try {
    const data = await api.get<MacrosResponse>(`/macros/${channelId.value}`)
    macros.value = data.macros
    loaded.value = true
  } catch (err: any) {
    toast.error(err?.message || '加载宏列表失败')
    macros.value = []
    loaded.value = false
  }
}

function copyValue(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    toast.success('已复制到剪贴板')
  }).catch(() => {
    toast.error('复制失败')
  })
}

function copyMacroSyntax(key: string) {
  navigator.clipboard.writeText(`{{${key}}}`).then(() => {
    toast.success(`已复制 {{${key}}}`)
  }).catch(() => {
    toast.error('复制失败')
  })
}

onMounted(loadChannels)
</script>

<template>
  <section class="stack">
    <!-- 频道选择 -->
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">频道选择</div>
          <div class="panel-subtitle">选择频道以查看该频道上下文中的所有可用宏变量及其当前值</div>
        </div>
        <span class="badge success">MACRO INSPECTOR</span>
      </div>
      <div class="panel-body">
        <div class="macro-channel-row">
          <select class="stellar-select" v-model="channelId" @change="loadMacros">
            <option value="" disabled>选择频道...</option>
            <option v-for="ch in channels" :key="ch.channelId" :value="ch.channelId">
              {{ ch.channelName || ch.channelId }} ({{ ch.channelId }})
            </option>
          </select>
          <input
            class="stellar-input"
            v-model="channelId"
            placeholder="或手动输入 Channel ID"
            @keyup.enter="loadMacros"
          />
          <button class="stellar-button" @click="loadMacros">加载宏</button>
        </div>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div v-if="loaded" class="grid-4">
      <div class="stat-card">
        <div class="stat-label">总宏数</div>
        <div class="stat-value">{{ macros.length }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">系统宏</div>
        <div class="stat-value">{{ systemCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">自定义宏</div>
        <div class="stat-value">{{ customCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前频道</div>
        <div class="stat-value stat-value-sm">{{ channelId.slice(-6) }}</div>
      </div>
    </div>

    <!-- 搜索 & 过滤 -->
    <div v-if="loaded" class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">宏变量列表</div>
          <div class="panel-subtitle">
            点击宏名复制 <span class="kbd" v-pre>{{macro}}</span> 语法，点击值复制内容
          </div>
        </div>
        <div class="macro-filter-group">
          <button
            class="stellar-button ghost"
            :class="{ active: filterSource === 'all' }"
            @click="filterSource = 'all'"
          >全部</button>
          <button
            class="stellar-button ghost"
            :class="{ active: filterSource === 'system' }"
            @click="filterSource = 'system'"
          >系统</button>
          <button
            class="stellar-button ghost"
            :class="{ active: filterSource === 'custom' }"
            @click="filterSource = 'custom'"
          >自定义</button>
        </div>
      </div>
      <div class="panel-body stack">
        <input
          class="stellar-input"
          v-model="searchQuery"
          placeholder="搜索宏名、值或描述..."
        />

        <div v-if="filteredMacros.length === 0" class="macro-empty">
          暂无匹配的宏变量
        </div>

        <table v-else class="stellar-table">
          <thead>
            <tr>
              <th style="width: 200px;">宏名</th>
              <th>当前值</th>
              <th style="width: 260px;">描述</th>
              <th style="width: 80px;">来源</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="macro in filteredMacros" :key="macro.key">
              <td>
                <span
                  class="macro-key"
                  @click="copyMacroSyntax(macro.key)"
                  :title="`点击复制 {{${macro.key}}}`"
                >
                  <span class="macro-brace" v-pre>{​{</span>{{ macro.key }}<span class="macro-brace" v-pre>}​}</span>
                </span>
              </td>
              <td>
                <span
                  class="macro-value"
                  @click="copyValue(macro.value)"
                  title="点击复制值"
                >
                  {{ macro.value.length > 120 ? macro.value.slice(0, 120) + '...' : macro.value || '(空)' }}
                </span>
              </td>
              <td class="muted">{{ macro.description }}</td>
              <td>
                <span
                  class="badge"
                  :class="macro.source === 'system' ? 'success' : 'warning'"
                >
                  {{ macro.source === 'system' ? '系统' : '自定义' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 未加载提示 -->
    <div v-if="!loaded" class="stellar-panel">
      <div class="panel-body macro-empty">
        选择一个频道并点击「加载宏」以查看所有可用宏变量 ✨
      </div>
    </div>
  </section>
</template>

<style scoped>
.macro-channel-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 10px;
  align-items: center;
}

.macro-filter-group {
  display: flex;
  gap: 4px;
}

.macro-filter-group .stellar-button.active {
  border-color: var(--highlight-mid);
  background: linear-gradient(180deg, #132a44, #10233c);
}

.macro-key {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--highlight);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s ease;
  word-break: break-all;
}

.macro-key:hover {
  background: var(--highlight-dim);
}

.macro-brace {
  color: var(--ink-muted);
  opacity: 0.6;
}

.macro-value {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: var(--ink-primary);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s ease;
  word-break: break-all;
}

.macro-value:hover {
  background: rgba(255, 255, 255, 0.05);
}

.macro-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--ink-muted);
  font-size: 13px;
}

.stat-value-sm {
  font-size: 15px;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

@media (max-width: 960px) {
  .macro-channel-row {
    grid-template-columns: 1fr;
  }
}
</style>