<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

type StageName = 'raw' | 'afterPreRegex' | 'afterMacro' | 'afterPostRegex'

interface ChannelOption {
  id: string
  name: string
}

const api = useApi()
const toast = useToast()

const activeStage = ref<StageName>('afterPostRegex')
const building = ref(false)
const channels = ref<ChannelOption[]>([])
const selectedChannel = ref('')

// 构建结果
const stageData = ref<Record<StageName, string>>({
  raw: '',
  afterPreRegex: '',
  afterMacro: '',
  afterPostRegex: '',
})
const mergedUserContent = ref('')
const historyCount = ref(0)
const summariesIncluded = ref(0)

// 选项
const outputFormat = ref<'openai' | 'gemini' | 'tagged' | 'text'>('openai')
const view = ref<'model' | 'user'>('model')
const useUnsummarized = ref(true)
const includeSummary = ref(true)

function toChannelName(x: any): string {
  const name = String(x?.channelName ?? '').trim()
  return name || String(x?.channelId ?? '')
}

function prettyJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

async function loadChannels() {
  try {
    const rows = await api.get<any[]>('/channels')
    channels.value = rows.map((x) => ({
      id: String(x.channelId),
      name: toChannelName(x),
    }))
    if (channels.value.length > 0 && !channels.value.some((x) => x.id === selectedChannel.value)) {
      selectedChannel.value = channels.value[0].id
    }
  } catch (err: any) {
    toast.error(err?.message || '加载频道失败')
  }
}

async function buildPrompt() {
  if (!selectedChannel.value) {
    toast.error('请先选择频道')
    return
  }

  building.value = true
  try {
    const data = await api.post<any>('/prompt/build', {
      channelId: selectedChannel.value,
      outputFormat: outputFormat.value,
      view: view.value,
      useUnsummarized: useUnsummarized.value,
      includeSummary: includeSummary.value,
    })

    const stages = data?.result?.stages ?? {}

    stageData.value = {
      raw: prettyJson(stages?.output?.raw ?? stages?.raw ?? []),
      afterPreRegex: prettyJson(stages?.output?.afterPreRegex ?? []),
      afterMacro: prettyJson(stages?.output?.afterMacro ?? []),
      afterPostRegex: prettyJson(stages?.output?.afterPostRegex ?? []),
    }

    mergedUserContent.value = String(data?.mergedUserContent ?? '')
    historyCount.value = Number(data?.historyCount ?? 0)
    summariesIncluded.value = Number(data?.summariesIncluded ?? 0)

    toast.success(`构建完成 · ${historyCount.value} 条历史 · ${summariesIncluded.value} 个总结`)
  } catch (err: any) {
    toast.error(err?.message || '构建失败')
    stageData.value = { raw: '', afterPreRegex: '', afterMacro: '', afterPostRegex: '' }
  } finally {
    building.value = false
  }
}

// 自动构建
watch(selectedChannel, () => {
  if (selectedChannel.value) buildPrompt()
})

// 计算当前阶段的消息数和 token 估算
const currentStageMessages = computed(() => {
  const raw = stageData.value[activeStage.value]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    // 过滤空 system 消息
    const filtered = parsed.filter((m: any) => {
      const content = typeof m?.content === 'string' ? m.content : (typeof m?.text === 'string' ? m.text : '')
      if (m?.role === 'system' && content.length === 0) return false
      return true
    })

    // 合并连续 system 消息
    const merged: any[] = []
    for (const msg of filtered) {
      const prev = merged[merged.length - 1]
      if (msg.role === 'system' && prev?.role === 'system') {
        const prevContent = typeof prev.content === 'string' ? prev.content : (prev.text ?? '')
        const curContent = typeof msg.content === 'string' ? msg.content : (msg.text ?? '')
        prev.content = `${prevContent}\n\n${curContent}`
        if (prev.text !== undefined) prev.text = prev.content
      } else {
        merged.push({ ...msg })
      }
    }
    return merged
  } catch {
    return []
  }
})

const currentStageStats = computed(() => {
  const msgs = currentStageMessages.value
  const totalChars = msgs.reduce((sum: number, m: any) => {
    const c = typeof m?.content === 'string' ? m.content : (typeof m?.text === 'string' ? m.text : '')
    return sum + c.length
  }, 0)
  return {
    messageCount: msgs.length,
    estTokens: Math.ceil(totalChars / 2),
  }
})

onMounted(async () => {
  await loadChannels()
  if (selectedChannel.value) {
    await buildPrompt()
  }
})
</script>

<template>
  <section class="stack">
    <!-- 构建控制 -->
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">Prompt 构建调试</div>
          <div class="panel-subtitle">选择频道 → 实时调用 /api/prompt/build → 查看各阶段输出</div>
        </div>
        <div class="split">
          <select class="stellar-select" v-model="selectedChannel" style="width: 200px;">
            <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <button class="stellar-button" :disabled="building" @click="buildPrompt">
            {{ building ? '构建中...' : '重新构建' }}
          </button>
        </div>
      </div>
      <div class="panel-body stack">
        <!-- 构建选项 -->
        <div class="split" style="flex-wrap: wrap; gap: 10px;">
          <label class="stack" style="min-width: 100px;">
            <span class="muted">输出格式</span>
            <select class="stellar-select" v-model="outputFormat">
              <option value="openai">openai</option>
              <option value="gemini">gemini</option>
              <option value="tagged">tagged</option>
              <option value="text">text</option>
            </select>
          </label>
          <label class="stack" style="min-width: 80px;">
            <span class="muted">视角</span>
            <select class="stellar-select" v-model="view">
              <option value="model">model</option>
              <option value="user">user</option>
            </select>
          </label>
          <label class="badge" style="cursor: pointer;">
            <input type="checkbox" v-model="useUnsummarized" /> 仅未总结
          </label>
          <label class="badge" style="cursor: pointer;">
            <input type="checkbox" v-model="includeSummary" /> 包含总结
          </label>
        </div>

        <!-- 统计 -->
        <div class="split" style="flex-wrap: wrap;">
          <span class="badge">历史: {{ historyCount }} msgs</span>
          <span class="badge warning">总结: {{ summariesIncluded }}</span>
          <span class="badge success">
            当前阶段: {{ currentStageStats.messageCount }} 条 / ~{{ currentStageStats.estTokens }} tokens
          </span>
        </div>

        <!-- 阶段切换 -->
        <div class="split" style="flex-wrap: wrap;">
          <button
            class="nav-item"
            :class="{ 'router-link-active': activeStage === 'raw' }"
            style="max-width: 160px;"
            @click="activeStage = 'raw'"
          >
            raw
          </button>
          <button
            class="nav-item"
            :class="{ 'router-link-active': activeStage === 'afterPreRegex' }"
            style="max-width: 160px;"
            @click="activeStage = 'afterPreRegex'"
          >
            afterPreRegex
          </button>
          <button
            class="nav-item"
            :class="{ 'router-link-active': activeStage === 'afterMacro' }"
            style="max-width: 160px;"
            @click="activeStage = 'afterMacro'"
          >
            afterMacro
          </button>
          <button
            class="nav-item"
            :class="{ 'router-link-active': activeStage === 'afterPostRegex' }"
            style="max-width: 160px;"
            @click="activeStage = 'afterPostRegex'"
          >
            afterPostRegex (最终)
          </button>
        </div>

        <!-- 阶段输出 -->
        <label class="stack">
          <span class="muted">阶段输出 · {{ activeStage }}</span>
          <textarea
            class="stellar-textarea"
            :value="stageData[activeStage]"
            readonly
            rows="16"
            style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;"
          />
        </label>
      </div>
    </div>

    <!-- 合并式聊天日志预览 -->
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">合并式聊天日志预览</div>
          <div class="panel-subtitle">发给 LLM 的 role:user 合并历史内容</div>
        </div>
        <span class="badge">{{ mergedUserContent.length }} chars</span>
      </div>
      <div class="panel-body">
        <textarea
          class="stellar-textarea"
          :value="mergedUserContent"
          readonly
          rows="12"
          style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;"
        />
      </div>
    </div>

    <!-- 最终消息列表（可视化） -->
    <div class="stellar-panel" v-if="currentStageMessages.length > 0">
      <div class="panel-header">
        <div>
          <div class="panel-title">最终消息列表 · {{ activeStage }}</div>
          <div class="panel-subtitle">逐条查看发给 LLM 的消息</div>
        </div>
        <span class="badge success">{{ currentStageMessages.length }} messages</span>
      </div>
      <div class="panel-body" style="max-height: 500px; overflow: auto;">
        <div class="stack">
          <div
            v-for="(msg, idx) in currentStageMessages"
            :key="idx"
            class="stellar-panel"
            style="border-color: var(--edge-default);"
          >
            <div class="panel-body stack" style="padding: 10px;">
              <div class="split">
                <span
                  class="badge"
                  :class="{
                    success: msg.role === 'assistant' || msg.role === 'model',
                    warning: msg.role === 'system',
                  }"
                  style="min-width: 70px; justify-content: center;"
                >
                  {{ msg.role }}
                </span>
                <span class="muted">#{{ idx + 1 }}</span>
                <span v-if="msg.name" class="kbd">{{ msg.name }}</span>
                <span v-if="msg.tag" class="kbd">{{ msg.tag }}</span>
                <span class="muted">{{ (msg.content || msg.text || '').length }} chars</span>
              </div>
              <pre style="white-space: pre-wrap; word-break: break-all; font-size: 12px; margin: 0; max-height: 200px; overflow: auto;">{{ msg.content || msg.text || '' }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>