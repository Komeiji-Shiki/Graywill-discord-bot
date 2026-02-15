<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

interface EndpointItem {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
  topP: number
  extraParams: string
  reasoningMaxTokens: number
  reasoningEffort: '' | 'auto' | 'low' | 'medium' | 'high'
  showThinking: boolean
  createdAt?: string
  updatedAt?: string
}

interface PresetBindingItem {
  id: string
  name: string
  data: string
  boundEndpointId: string
  updatedAt?: string
}

const api = useApi()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const loadingModels = ref(false)
const bindingSaving = ref(false)

const modelFetchError = ref('')
const remoteModels = ref<string[]>([])
const modelSearch = ref('')

const endpoints = ref<EndpointItem[]>([])
const activeId = ref('')
const presetBindings = ref<PresetBindingItem[]>([])
const activeBindingPresetId = ref('')

const active = computed(
  () => endpoints.value.find((item: EndpointItem) => item.id === activeId.value) ?? null
)

const filteredModels = computed(() => {
  const kw = modelSearch.value.trim().toLowerCase()
  if (!kw) return remoteModels.value
  return remoteModels.value.filter((id: string) => id.toLowerCase().includes(kw))
})

type XmlToolsMode = 'auto' | 'xml' | 'native'

const activeModel = computed(() => active.value?.model ?? '')
const activeBaseUrl = computed(() => active.value?.baseUrl ?? '')

function parseBooleanCompatFlag(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v !== 'string') return null

  const s = v.trim().toLowerCase()
  if (!s) return null
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return null
}

function parseExtraParamsSafe(raw: string): Record<string, unknown> {
  try {
    return parseExtraParams(raw)
  } catch {
    return {}
  }
}

function getXmlToolsMode(item: EndpointItem): XmlToolsMode {
  const params = parseExtraParamsSafe(item.extraParams || '{}')
  const forceNative =
    parseBooleanCompatFlag((params as any).forceNativeTools) ??
    parseBooleanCompatFlag((params as any).force_native_tools) ??
    false
  if (forceNative) return 'native'

  const useXml =
    parseBooleanCompatFlag((params as any).useXmlTools) ??
    parseBooleanCompatFlag((params as any).use_xml_tools) ??
    false
  if (useXml) return 'xml'

  return 'auto'
}

function setXmlToolsMode(item: EndpointItem, mode: XmlToolsMode) {
  const params = parseExtraParamsSafe(item.extraParams || '{}')

  delete (params as any).useXmlTools
  delete (params as any).use_xml_tools
  delete (params as any).forceNativeTools
  delete (params as any).force_native_tools

  if (mode === 'xml') {
    ;(params as any).useXmlTools = true
  } else if (mode === 'native') {
    ;(params as any).forceNativeTools = true
  }

  item.extraParams = JSON.stringify(params, null, 2)
}

const activeXmlToolsMode = computed<XmlToolsMode>({
  get() {
    if (!active.value) return 'auto'
    return getXmlToolsMode(active.value)
  },
  set(mode) {
    if (!active.value) return
    setXmlToolsMode(active.value, mode)
  },
})

function resetModelPanel() {
  remoteModels.value = []
  modelSearch.value = ''
  modelFetchError.value = ''
}

function safeParsePresetData(raw: string): Record<string, unknown> {
  const text = String(raw ?? '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // noop
  }
  return {}
}

function extractBoundEndpointIdFromPresetData(raw: string): string {
  const parsed = safeParsePresetData(raw)
  const endpointId = String(
    (parsed as any)?.apiSetting?.endpointId ?? (parsed as any)?.apiSetting?.boundEndpointId ?? ''
  ).trim()
  return endpointId
}

function normalizePresetBinding(x: any): PresetBindingItem {
  const data = String(x?.data ?? '{}')
  return {
    id: String(x?.id ?? ''),
    name: String(x?.name ?? ''),
    data,
    boundEndpointId: extractBoundEndpointIdFromPresetData(data),
    updatedAt: x?.updatedAt ? String(x.updatedAt) : undefined,
  }
}

function buildPresetDataWithBoundEndpoint(rawData: string, endpointId: string): string {
  const root = safeParsePresetData(rawData)
  const apiSettingRaw = (root as any).apiSetting
  const apiSetting =
    apiSettingRaw && typeof apiSettingRaw === 'object' && !Array.isArray(apiSettingRaw)
      ? { ...(apiSettingRaw as Record<string, unknown>) }
      : {}

  delete (apiSetting as any).boundEndpointId

  if (endpointId) {
    ;(apiSetting as any).endpointId = endpointId
  } else {
    delete (apiSetting as any).endpointId
  }

  if (Object.keys(apiSetting).length > 0) {
    ;(root as any).apiSetting = apiSetting
  } else {
    delete (root as any).apiSetting
  }

  return JSON.stringify(root)
}

function syncActiveBindingSelection() {
  if (!active.value) {
    activeBindingPresetId.value = ''
    return
  }
  const endpointId = active.value.id
  const found = presetBindings.value.find((p) => p.boundEndpointId === endpointId)
  activeBindingPresetId.value = found?.id ?? ''
}

function normalizeEndpoint(x: any): EndpointItem {
  return {
    id: String(x?.id ?? ''),
    name: String(x?.name ?? ''),
    baseUrl: String(x?.baseUrl ?? ''),
    apiKey: String(x?.apiKey ?? ''),
    model: String(x?.model ?? ''),
    maxTokens: Number(x?.maxTokens ?? 1024),
    temperature: Number(x?.temperature ?? 0.7),
    topP: Number(x?.topP ?? 1),
    extraParams: String(x?.extraParams ?? '{}'),
    reasoningMaxTokens: Math.max(0, Number(x?.reasoningMaxTokens ?? 0)),
    reasoningEffort: (['', 'auto', 'low', 'medium', 'high'] as const).includes(
      String(x?.reasoningEffort ?? '') as any
    )
      ? (String(x?.reasoningEffort ?? '') as '' | 'auto' | 'low' | 'medium' | 'high')
      : '',
    showThinking: Boolean(x?.showThinking),
    createdAt: x?.createdAt ? String(x.createdAt) : undefined,
    updatedAt: x?.updatedAt ? String(x.updatedAt) : undefined,
  }
}

async function loadEndpoints() {
  loading.value = true
  try {
    const [endpointRows, presetRows] = await Promise.all([
      api.get<EndpointItem[]>('/endpoints'),
      api.get<Array<{ id: string; name: string; data: string; updatedAt?: string }>>('/presets'),
    ])

    endpoints.value = endpointRows.map(normalizeEndpoint)
    presetBindings.value = presetRows.map(normalizePresetBinding)

    if (endpoints.value.length > 0 && !endpoints.value.some((x) => x.id === activeId.value)) {
      activeId.value = endpoints.value[0].id
    }
    if (endpoints.value.length === 0) {
      activeId.value = ''
    }

    syncActiveBindingSelection()
  } finally {
    loading.value = false
  }
}

function parseExtraParams(raw: string): Record<string, unknown> {
  const text = raw.trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    throw new Error('Extra Params 必须是合法 JSON 对象')
  }
  throw new Error('Extra Params 必须是 JSON 对象')
}

async function saveEndpoint() {
  if (!active.value) return
  saving.value = true
  try {
    parseExtraParams(active.value.extraParams || '{}')

    await api.post<{ message?: string }>('/endpoints', {
      id: active.value.id,
      name: active.value.name,
      baseUrl: active.value.baseUrl,
      apiKey: active.value.apiKey,
      model: active.value.model,
      maxTokens: Math.max(1, Math.floor(active.value.maxTokens || 1024)),
      temperature: active.value.temperature,
      topP: active.value.topP,
      extraParams: active.value.extraParams || '{}',
      reasoningMaxTokens: Math.max(0, Math.floor(active.value.reasoningMaxTokens || 0)),
      reasoningEffort: active.value.reasoningEffort || '',
      showThinking: !!active.value.showThinking,
    })

    await loadEndpoints()
    toast.success('端点已保存')
  } catch (err: any) {
    toast.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function discoverModels() {
  if (!active.value) return
  loadingModels.value = true
  modelFetchError.value = ''
  remoteModels.value = []

  try {
    const ids = await api.post<string[]>('/llm/discover-models', {
      baseUrl: active.value.baseUrl,
      apiKey: active.value.apiKey || undefined,
    })
    remoteModels.value = ids

    if (ids.length > 0 && !ids.includes(active.value.model)) {
      active.value.model = ids[0]
    }
  } catch (err: any) {
    modelFetchError.value = err?.message ?? '模型拉取失败'
  } finally {
    loadingModels.value = false
  }
}

async function testConnection() {
  if (!active.value) return
  testing.value = true
  try {
    await api.post<string[]>('/llm/discover-models', {
      baseUrl: active.value.baseUrl,
      apiKey: active.value.apiKey || undefined,
    })
    toast.success('连接成功：/models 可访问')
  } catch (err: any) {
    toast.error(err?.message || '连接失败')
  } finally {
    testing.value = false
  }
}

function pickModel(id: string) {
  if (!active.value) return
  active.value.model = id
}

async function savePresetBinding() {
  if (!active.value) return
  const endpointId = String(active.value.id ?? '').trim()
  if (!endpointId) return

  const selectedPresetId = String(activeBindingPresetId.value ?? '').trim()

  bindingSaving.value = true
  try {
    const changedPayloads: Array<{ id: string; name: string; data: string }> = []

    for (const preset of presetBindings.value) {
      const currentBound = String(preset.boundEndpointId ?? '').trim()
      let nextBound = currentBound

      if (selectedPresetId) {
        if (preset.id === selectedPresetId) nextBound = endpointId
        else if (currentBound === endpointId) nextBound = ''
      } else {
        if (currentBound === endpointId) nextBound = ''
      }

      if (nextBound === currentBound) continue

      changedPayloads.push({
        id: preset.id,
        name: preset.name,
        data: buildPresetDataWithBoundEndpoint(preset.data, nextBound),
      })
    }

    if (changedPayloads.length === 0) {
      toast.info('绑定关系未变化')
      return
    }

    await Promise.all(
      changedPayloads.map((item) =>
        api.post<{ message?: string }>('/presets', {
          id: item.id,
          name: item.name,
          data: item.data,
        })
      )
    )

    const keepActiveId = activeId.value
    await loadEndpoints()
    if (keepActiveId && endpoints.value.some((x) => x.id === keepActiveId)) {
      activeId.value = keepActiveId
      syncActiveBindingSelection()
    }

    if (selectedPresetId) {
      const selected = presetBindings.value.find((p) => p.id === selectedPresetId)
      toast.success(`绑定已保存：${active.value?.name || endpointId} -> ${selected?.name || selectedPresetId}`)
    } else {
      toast.success('已清除当前模型端点的预设绑定')
    }
  } catch (err: any) {
    toast.error(err?.message || '保存绑定失败')
  } finally {
    bindingSaving.value = false
  }
}

function createEndpoint() {
  const id = `ep-${Date.now()}`
  endpoints.value.unshift({
    id,
    name: 'New Endpoint',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '',
    model: 'model-name',
    maxTokens: 1024,
    temperature: 0.7,
    topP: 1,
    extraParams: '{}',
    reasoningMaxTokens: 0,
    reasoningEffort: '',
    showThinking: false,
    updatedAt: new Date().toISOString(),
  })
  activeId.value = id
  resetModelPanel()
  toast.info('新端点为本地草稿，点击保存后写入后端')
}

async function copyEndpoint() {
  if (!active.value) return
  try {
    const copied = await api.post<EndpointItem>(`/endpoints/${encodeURIComponent(active.value.id)}/copy`)
    toast.success('端点已复制')
    await loadEndpoints()
    if (copied?.id) {
      activeId.value = copied.id
    }
  } catch (err: any) {
    toast.error(err?.message || '复制失败')
  }
}

async function removeEndpoint() {
  if (!active.value) return
  try {
    await api.del(`/endpoints/${active.value.id}`)
    toast.success('端点已删除')
    await loadEndpoints()
  } catch (err: any) {
    // 本地草稿
    endpoints.value = endpoints.value.filter((x) => x.id !== active.value!.id)
    activeId.value = endpoints.value[0]?.id ?? ''
    toast.warning(err?.message || '已从本地移除')
  }
}

watch(activeId, () => {
  resetModelPanel()
  syncActiveBindingSelection()
})

onMounted(loadEndpoints)
</script>

<template>
  <section class="grid-2">
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">模型端点</div>
          <div class="panel-subtitle">OpenAI-Compatible URL / Key / Model 参数模板</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost" @click="createEndpoint">新建</button>
          <button class="stellar-button ghost" @click="copyEndpoint" :disabled="!active">复制</button>
          <button class="stellar-button danger" @click="removeEndpoint" :disabled="!active">删除</button>
          <button class="stellar-button" :disabled="loading" @click="loadEndpoints">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
        </div>
      </div>
      <div class="panel-body stack">
        <button
          v-for="item in endpoints"
          :key="item.id"
          class="nav-item"
          :class="{ 'router-link-active': item.id === activeId }"
          @click="activeId = item.id"
        >
          <div class="split">
            <span>{{ item.name }}</span>
            <span class="badge">{{ item.model }}</span>
          </div>
          <div class="muted" style="margin-top: 4px; font-size: 11px;">
            {{ item.baseUrl }} · {{ item.updatedAt || '未保存' }}
          </div>
        </button>
      </div>
    </div>

    <div class="stack" v-if="active">
      <div class="stellar-panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">编辑端点 · {{ active.name }}</div>
            <div class="panel-subtitle">用于频道配置中的 endpoint 绑定</div>
          </div>
          <div class="split">
            <button class="stellar-button ghost" :disabled="testing" @click="testConnection">
              {{ testing ? '测试中...' : '测试连接' }}
            </button>
            <button class="stellar-button" :disabled="saving" @click="saveEndpoint">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
        <div class="panel-body stack">
          <div class="grid-2">
            <label class="stack">
              <span class="muted">名称</span>
              <input class="stellar-input" v-model="active.name" />
            </label>
            <label class="stack">
              <span class="muted">模型（可手填）</span>
              <input class="stellar-input" v-model="active.model" />
            </label>
            <label class="stack">
              <span class="muted">Base URL</span>
              <input class="stellar-input" v-model="active.baseUrl" />
            </label>
            <label class="stack">
              <span class="muted">API Key</span>
              <input class="stellar-input" v-model="active.apiKey" type="password" />
            </label>
            <label class="stack">
              <span class="muted">Max Tokens</span>
              <input class="stellar-input" type="number" v-model.number="active.maxTokens" />
            </label>
            <label class="stack">
              <span class="muted">Temperature</span>
              <input class="stellar-input" type="number" step="0.1" v-model.number="active.temperature" />
            </label>
            <label class="stack">
              <span class="muted">Top P</span>
              <input class="stellar-input" type="number" step="0.1" v-model.number="active.topP" />
            </label>
            <label class="stack">
              <span class="muted">思考 Token 预算（0=自动）</span>
              <input class="stellar-input" type="number" min="0" v-model.number="active.reasoningMaxTokens" />
            </label>
            <label class="stack">
              <span class="muted">思考努力程度</span>
              <select class="stellar-select" v-model="active.reasoningEffort">
                <option value="">（未指定）</option>
                <option value="auto">auto</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label class="stack">
              <span class="muted">显示思维链（仅思考中可见）</span>
              <select class="stellar-select" v-model="active.showThinking">
                <option :value="true">开启</option>
                <option :value="false">关闭</option>
              </select>
            </label>
            <label class="stack">
              <span class="muted">工具调用兼容模式</span>
              <select class="stellar-select" v-model="activeXmlToolsMode">
                <option value="auto">自动（Claude 默认走 XML）</option>
                <option value="xml">强制 XML 兼容</option>
                <option value="native">强制原生 Tools</option>
              </select>
            </label>
          </div>

          <label class="stack">
            <span class="muted">Extra Params (JSON)</span>
            <textarea class="stellar-textarea" v-model="active.extraParams" />
          </label>
        </div>
      </div>

      <div class="stellar-panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">预设绑定</div>
            <div class="panel-subtitle">在模型端点处选择预设（切换模型时自动切预设）</div>
          </div>
          <div class="split">
            <button class="stellar-button" :disabled="bindingSaving || !active" @click="savePresetBinding">
              {{ bindingSaving ? '保存中...' : '保存绑定' }}
            </button>
          </div>
        </div>
        <div class="panel-body stack">
          <label class="stack">
            <span class="muted">当前端点绑定预设</span>
            <select class="stellar-select" v-model="activeBindingPresetId">
              <option value="">（不绑定）</option>
              <option v-for="preset in presetBindings" :key="preset.id" :value="preset.id">
                {{ preset.name }}
              </option>
            </select>
          </label>
          <div class="muted">
            绑定后，在频道页切换“模型端点”会自动切换到这里指定的预设。
          </div>
        </div>
      </div>

      <div class="stellar-panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">从端点获取模型</div>
            <div class="panel-subtitle">读取 {{ activeBaseUrl }}/models 并支持本地搜索</div>
          </div>
          <div class="split">
            <button class="stellar-button ghost" :disabled="loadingModels" @click="discoverModels">
              {{ loadingModels ? '拉取中...' : '拉取模型列表' }}
            </button>
          </div>
        </div>
        <div class="panel-body stack">
          <label class="stack">
            <span class="muted">搜索模型</span>
            <input class="stellar-input" v-model="modelSearch" placeholder="输入关键词过滤，如 gpt / deepseek / qwen" />
          </label>

          <div v-if="modelFetchError" class="badge danger">
            {{ modelFetchError }}
          </div>

          <div class="stack" style="max-height: 280px; overflow: auto;">
            <button
              v-for="id in filteredModels"
              :key="id"
              class="nav-item"
              :class="{ 'router-link-active': id === activeModel }"
              @click="pickModel(id)"
            >
              <div class="split">
                <span>{{ id }}</span>
                <span class="badge success" v-if="id === activeModel">当前</span>
              </div>
            </button>
            <div class="muted" v-if="!loadingModels && filteredModels.length === 0">
              暂无模型。请检查端点、跨域策略或 API Key，然后重新拉取。
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>