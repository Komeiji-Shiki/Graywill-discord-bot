<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'
import DraggableList, { type DraggableItem } from '../components/DraggableList.vue'

type ActiveTab = 'prompts' | 'worldbook' | 'regex' | 'settings'
type ActivationMode = 'always' | 'keyword' | 'vector'
type SelectiveLogic = 'andAny' | 'andAll' | 'notAny' | 'notAll'

interface PromptItem {
  id: string
  name: string
  role: 'system' | 'user' | 'assistant'
  position: 'relative' | 'fixed'
  depth: number
  order: number
  enabled: boolean
  content: string
  /** ST marker 标记，标识是否为占位符插槽 */
  marker?: boolean
}

interface WbEntry {
  id: string
  name: string
  enabled: boolean
  activationMode: ActivationMode
  key: string
  secondaryKey: string
  selectiveLogic: SelectiveLogic
  position: string
  depth: number
  order: number
  probability: number
  content: string
}

interface RegexItem {
  id: string
  name: string
  enabled: boolean
  findRegex: string
  replaceRegex: string
  trimRegex: string
  targets: string[]
  view: string[]
}

interface PresetItem {
  id: string
  name: string
  prompts: PromptItem[]
  worldbook: WbEntry[]
  regexScripts: RegexItem[]
  assistantPrefill: string
  /** 预设绑定的模型端点 ID（可空） */
  boundEndpointId: string
  updatedAt: string
}

interface BackendPresetRecord {
  id: string
  name: string
  data: string
  updatedAt: string
}

interface EndpointOption {
  id: string
  name: string
  model: string
}

const api = useApi()
const toast = useToast()
const loading = ref(false)
const saving = ref(false)

const presets = ref<PresetItem[]>([])

const activePresetId = ref('')
const activeTab = ref<ActiveTab>('prompts')
const activePromptId = ref('')
const activeWbId = ref('')
const activeRegexId = ref('')

const endpointOptions = ref<EndpointOption[]>([])

const activePreset = computed(
  () => presets.value.find((p: PresetItem) => p.id === activePresetId.value) ?? null
)

const activePrompts = computed(() => activePreset.value?.prompts ?? [])
const activeWb = computed(() => activePreset.value?.worldbook ?? [])
const activeRegexScripts = computed(() => activePreset.value?.regexScripts ?? [])
const activeRegex = computed(
  () => activeRegexScripts.value.find((r: RegexItem) => r.id === activeRegexId.value) ?? null
)

const promptDraggableItems = computed<DraggableItem[]>(() =>
  activePrompts.value.map((p) => ({
    id: p.id,
    label: p.name,
    subtitle: `${p.role} / ${p.position} / depth=${p.depth} / order=${p.order}`,
    enabled: p.enabled,
  }))
)

function onPromptReorder(items: DraggableItem[]) {
  if (!activePreset.value) return
  const idOrder = items.map((x) => x.id)
  activePreset.value.prompts = idOrder
    .map((id) => activePreset.value!.prompts.find((p) => p.id === id))
    .filter(Boolean) as typeof activePreset.value.prompts
  activePreset.value.prompts.forEach((p, i) => {
    p.order = i * 10
  })
}

function onPromptToggle(item: DraggableItem) {
  if (!activePreset.value) return
  const prompt = activePreset.value.prompts.find((p) => p.id === item.id)
  if (prompt) prompt.enabled = !prompt.enabled
}

function onPromptDelete(item: DraggableItem) {
  if (!activePreset.value) return
  if (!confirm(`删除 Prompt「${item.label}」？`)) return
  activePreset.value.prompts = activePreset.value.prompts.filter((p) => p.id !== item.id)
  if (activePromptId.value === item.id) {
    activePromptId.value = activePreset.value.prompts[0]?.id ?? ''
  }
}

/** 直接修改 presets 数组中目标对象的 name（绕过 computed 只读问题） */
function updatePresetName(newName: string) {
  const target = presets.value.find((p) => p.id === activePresetId.value)
  if (target) target.name = newName
}

const activePrompt = computed(
  () => activePrompts.value.find((p: PromptItem) => p.id === activePromptId.value) ?? null
)

const activeWbEntry = computed(
  () => activeWb.value.find((e: WbEntry) => e.id === activeWbId.value) ?? null
)

function nowLabel() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function splitComma(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean)
  return String(raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function toPromptRole(raw: unknown): PromptItem['role'] {
  const r = String(raw ?? 'system').toLowerCase()
  if (r === 'user') return 'user'
  if (r === 'assistant' || r === 'model') return 'assistant'
  return 'system'
}

function toActivationMode(raw: unknown): ActivationMode {
  const r = String(raw ?? 'keyword')
  if (r === 'always' || r === 'keyword' || r === 'vector') return r
  return 'keyword'
}

function toSelectiveLogic(raw: unknown): SelectiveLogic {
  const r = String(raw ?? 'andAny')
  if (r === 'andAny' || r === 'andAll' || r === 'notAny' || r === 'notAll') return r
  return 'andAny'
}

function createDefaultPrompts(): PromptItem[] {
  return [
    {
      id: 'main',
      name: 'Main Prompt',
      role: 'system',
      position: 'relative',
      depth: 0,
      order: 100,
      enabled: true,
      content: '你是一个有帮助的助手。',
    },
    {
      id: 'charDescription',
      name: 'Character Description',
      role: 'system',
      position: 'relative',
      depth: 0,
      order: 90,
      enabled: true,
      content: '{{charDescription}}',
    },
    {
      id: 'summaryHistory',
      name: 'Summary',
      role: 'system',
      position: 'relative',
      depth: 0,
      order: 60,
      enabled: true,
      content: '{{summaryContent}}',
    },
    {
      id: 'chatHistory',
      name: 'Chat History',
      role: 'system',
      position: 'relative',
      depth: 0,
      order: 50,
      enabled: true,
      content: '',
    },
  ]
}

function createPresetTemplate(id = `preset-${Date.now()}`, name = 'New Preset'): PresetItem {
  return {
    id,
    name,
    prompts: createDefaultPrompts(),
    worldbook: [],
    regexScripts: [],
    assistantPrefill: '',
    boundEndpointId: '',
    updatedAt: nowLabel(),
  }
}

function safeParseJson(raw: string): any | null {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function extractWorldbookEntries(parsed: any): any[] {
  if (Array.isArray(parsed?.worldbook)) return parsed.worldbook
  if (Array.isArray(parsed?.worldBooks)) {
    const arr = parsed.worldBooks
    if (arr.every((x: any) => x && typeof x === 'object' && Array.isArray(x.entries))) {
      return arr.flatMap((x: any) => x.entries)
    }
    return arr
  }
  return []
}

function parsePresetRecord(row: BackendPresetRecord): PresetItem {
  const parsed = safeParseJson(row.data)
  if (!parsed || typeof parsed !== 'object') {
    const fallback = createPresetTemplate(row.id, row.name)
    fallback.updatedAt = row.updatedAt
    return fallback
  }

  const prompts: PromptItem[] = Array.isArray(parsed.prompts)
    ? parsed.prompts.map((x: any, i: number) => ({
        id: String(x?.identifier ?? x?.id ?? `prompt-${i}`),
        name: String(x?.name ?? `Prompt ${i + 1}`),
        role: toPromptRole(x?.role),
        position: x?.position === 'fixed' ? 'fixed' : 'relative',
        depth: Number(x?.depth ?? 0),
        order: Number(x?.order ?? i * 10),
        enabled: Boolean(x?.enabled ?? true),
        content: String(x?.content ?? ''),
      }))
    : createDefaultPrompts()

  const worldbookEntries = extractWorldbookEntries(parsed)
  const worldbook: WbEntry[] = worldbookEntries.map((x: any, i: number) => ({
    id: String(x?.id ?? x?.uid ?? `wb-${i}`),
    name: String(x?.name ?? `WorldBook ${i + 1}`),
    enabled: Boolean(x?.enabled ?? true),
    activationMode: toActivationMode(x?.activationMode),
    key: splitComma(x?.key).join(', '),
    secondaryKey: splitComma(x?.secondaryKey).join(', '),
    selectiveLogic: toSelectiveLogic(x?.selectiveLogic),
    position: String(x?.position ?? 'beforeChar'),
    depth: Number(x?.depth ?? 0),
    order: Number(x?.order ?? i * 10),
    probability: Number(x?.probability ?? 100),
    content: String(x?.content ?? ''),
  }))

  const regexScripts: RegexItem[] = Array.isArray(parsed.regexScripts)
    ? parsed.regexScripts.map((x: any, i: number) => ({
        id: String(x?.id ?? `regex-${i}`),
        name: String(x?.name ?? `Regex ${i + 1}`),
        enabled: Boolean(x?.enabled ?? true),
        findRegex: String(x?.findRegex ?? ''),
        replaceRegex: String(x?.replaceRegex ?? ''),
        trimRegex: Array.isArray(x?.trimRegex)
          ? x.trimRegex.map((v: any) => String(v)).join('\n')
          : String(x?.trimRegex ?? ''),
        targets: Array.isArray(x?.targets) ? x.targets.map((v: any) => String(v)) : [],
        view: Array.isArray(x?.view) ? x.view.map((v: any) => String(v)) : [],
      }))
    : []

  return {
    id: row.id,
    name: row.name || String(parsed?.name ?? row.id),
    prompts,
    worldbook,
    regexScripts,
    assistantPrefill: String(parsed?.assistantPrefill ?? parsed?.apiSetting?.assistantPrefill ?? ''),
    boundEndpointId: String(
      parsed?.apiSetting?.endpointId ?? parsed?.apiSetting?.boundEndpointId ?? ''
    ),
    updatedAt: row.updatedAt,
  }
}

function toStoredPrompt(item: PromptItem) {
  return {
    identifier: item.id,
    name: item.name,
    enabled: item.enabled,
    role: item.role,
    content: item.content,
    depth: item.depth,
    order: item.order,
    trigger: [],
    position: item.position,
  }
}

function toStoredWbEntry(item: WbEntry, index: number) {
  return {
    index,
    name: item.name,
    content: item.content,
    enabled: item.enabled,
    activationMode: item.activationMode,
    key: splitComma(item.key),
    secondaryKey: splitComma(item.secondaryKey),
    selectiveLogic: item.selectiveLogic,
    order: item.order,
    depth: item.depth,
    position: item.position,
    role: null,
    caseSensitive: null,
    excludeRecursion: false,
    preventRecursion: false,
    probability: item.probability,
    other: {},
  }
}

function toStoredRegex(item: RegexItem) {
  return {
    id: item.id,
    name: item.name,
    enabled: item.enabled,
    findRegex: item.findRegex,
    replaceRegex: item.replaceRegex,
    trimRegex: item.trimRegex
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
    targets: item.targets,
    view: item.view,
    runOnEdit: false,
    macroMode: 'none',
    minDepth: null,
    maxDepth: null,
  }
}

function buildPresetData(preset: PresetItem) {
  const endpointId = String(preset.boundEndpointId ?? '').trim()
  const apiSetting: Record<string, unknown> = {}
  if (endpointId) {
    apiSetting.endpointId = endpointId
  }

  return {
    name: preset.name,
    apiSetting,
    prompts: preset.prompts.map(toStoredPrompt),
    regexScripts: preset.regexScripts.map(toStoredRegex),
    worldbook: preset.worldbook.map(toStoredWbEntry),
    assistantPrefill: preset.assistantPrefill,
  }
}

function sanitizeFilename(input: string): string {
  const raw = String(input ?? '').trim()
  const cleaned = raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
  return cleaned || 'preset'
}

function downloadJsonFile(filename: string, data: unknown) {
  const text = JSON.stringify(data, null, 2)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function resetActiveChildren() {
  activeTab.value = 'prompts'
  activePromptId.value = activePrompts.value[0]?.id ?? ''
  activeWbId.value = activeWb.value[0]?.id ?? ''
  activeRegexId.value = activeRegexScripts.value[0]?.id ?? ''
}

async function loadPresets() {
  loading.value = true
  try {
    const [rows, endpointRows] = await Promise.all([
      api.get<BackendPresetRecord[]>('/presets'),
      api.get<Array<{ id: string; name: string; model: string }>>('/endpoints'),
    ])
    presets.value = rows.map(parsePresetRecord)
    endpointOptions.value = endpointRows.map((x) => ({
      id: String(x.id),
      name: String(x.name),
      model: String(x.model),
    }))

    if (presets.value.length > 0 && !presets.value.some((x) => x.id === activePresetId.value)) {
      activePresetId.value = presets.value[0].id
    }

    if (presets.value.length === 0) {
      activePresetId.value = ''
      activePromptId.value = ''
      activeWbId.value = ''
    }
  } catch (err: any) {
    toast.error(err?.message || '加载预设失败')
  } finally {
    loading.value = false
  }
}

async function savePreset() {
  if (!activePreset.value) return
  saving.value = true

  const id = activePreset.value.id
  try {
    const data = buildPresetData(activePreset.value)
    await api.post<{ message?: string }>('/presets', {
      id: activePreset.value.id,
      name: activePreset.value.name,
      data: JSON.stringify(data),
    })

    await loadPresets()
    activePresetId.value = id
    toast.success('预设已保存')
  } catch (err: any) {
    toast.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function copyPreset() {
  if (!activePreset.value) return
  try {
    const copied = await api.post<BackendPresetRecord>(
      `/presets/${encodeURIComponent(activePreset.value.id)}/copy`
    )
    toast.success('预设已复制')
    await loadPresets()
    if (copied?.id) {
      activePresetId.value = copied.id
    }
  } catch (err: any) {
    toast.error(err?.message || '复制失败')
  }
}

function exportPreset() {
  if (!activePreset.value) return
  try {
    const payload = buildPresetData(activePreset.value)
    const base = sanitizeFilename(activePreset.value.name || activePreset.value.id)
    const filename = `${base}.json`
    downloadJsonFile(filename, payload)
    toast.success(`已导出 ${filename}`)
  } catch (err: any) {
    toast.error(err?.message || '导出失败')
  }
}

async function deletePreset() {
  if (!activePreset.value) return
  const name = activePreset.value.name
  if (!confirm(`确认删除预设「${name}」吗？此操作不可撤销。`)) return
  try {
    await api.del<{ message?: string }>(`/presets/${activePreset.value.id}`)
    toast.success(`预设「${name}」已删除`)
    activePresetId.value = ''
    await loadPresets()
  } catch (err: any) {
    toast.error(err?.message || '删除失败')
  }
}

// 切换预设时自动选中第一项
watch(activePresetId, () => {
  resetActiveChildren()
})

// 初始化
watch(activePrompts, () => {
  if (!activePromptId.value && activePrompts.value.length > 0) {
    activePromptId.value = activePrompts.value[0].id
  }
})

watch(activeWb, () => {
  if (!activeWbId.value && activeWb.value.length > 0) {
    activeWbId.value = activeWb.value[0].id
  }
})

function selectPreset(id: string) {
  activePresetId.value = id
}

function createPreset() {
  const id = `preset-${Date.now()}`
  presets.value.unshift(createPresetTemplate(id))
  activePresetId.value = id
  resetActiveChildren()
  toast.info('新预设为本地草稿，点击保存后写入后端')
}

// ─── ST 预设导入 ─────────────────────────────────

const stImportInput = ref<HTMLInputElement | null>(null)

function triggerStImport() {
  stImportInput.value?.click()
}

/**
 * ST placement 数字 → 我们内部 targets 的映射
 * ST: 1=slashCommand, 2=aiOutput(display), 3=userInput, 4=worldBook, 5=aiOutput(prompt), 6=aiOutput(edit)
 */
function mapStPlacement(placements: number[]): string[] {
  const targets = new Set<string>()
  for (const p of placements) {
    if (p === 1) targets.add('slashCommands')
    else if (p === 2 || p === 5 || p === 6) targets.add('aiOutput')
    else if (p === 3) targets.add('userInput')
    else if (p === 4) targets.add('worldBook')
  }
  return [...targets]
}

/** 将 ST 正则脚本 → 内部 RegexItem */
function convertStRegex(stRegex: any, index: number): RegexItem {
  return {
    id: String(stRegex?.id ?? `st-regex-${index}`),
    name: String(stRegex?.scriptName ?? stRegex?.name ?? `Regex ${index + 1}`),
    enabled: !(stRegex?.disabled ?? false),
    findRegex: String(stRegex?.findRegex ?? ''),
    replaceRegex: String(stRegex?.replaceString ?? stRegex?.replaceRegex ?? ''),
    trimRegex: Array.isArray(stRegex?.trimStrings)
      ? stRegex.trimStrings.map((v: any) => String(v)).join('\n')
      : '',
    targets: mapStPlacement(Array.isArray(stRegex?.placement) ? stRegex.placement : []),
    view: [],
  }
}

/**
 * 核心：将 SillyTavern 预设 JSON 转换为我们的 PresetItem
 * 处理：prompts + prompt_order 排序 + regex_scripts + SPreset 正则 + assistant_prefill
 */
function convertStPreset(stJson: any, fileName: string): PresetItem {
  const stPrompts: any[] = Array.isArray(stJson.prompts) ? stJson.prompts : []

  // 1. 应用 prompt_order 排序 & enabled 覆盖
  let orderedPrompts: any[] = []
  const promptOrder = stJson.prompt_order
  if (Array.isArray(promptOrder) && promptOrder.length > 0) {
    // 取第一个 character_id 的 order（ST 约定）
    const orderArr: { identifier: string; enabled: boolean }[] =
      Array.isArray(promptOrder[0]?.order) ? promptOrder[0].order : promptOrder
    const promptMap = new Map(stPrompts.map((p) => [p.identifier, p]))

    for (const entry of orderArr) {
      const prompt = promptMap.get(entry.identifier)
      if (prompt) {
        // prompt_order 的 enabled 会覆盖 prompts 里的 enabled
        orderedPrompts.push({ ...prompt, enabled: entry.enabled })
        promptMap.delete(entry.identifier)
      }
    }
    // 剩余未在 order 中出现的 prompts 追加到末尾
    for (const [, p] of promptMap) {
      orderedPrompts.push(p)
    }
  } else {
    orderedPrompts = stPrompts
  }

  // 2. 转换 prompts 到内部格式
  const prompts: PromptItem[] = orderedPrompts.map((p, i) => {
    const role = toPromptRole(p?.role)
    const isMarker = Boolean(p?.marker) && Boolean(p?.system_prompt)
    return {
      id: String(p?.identifier ?? `st-prompt-${i}`),
      name: String(p?.name ?? `Prompt ${i + 1}`),
      role,
      position: 'relative' as const,
      depth: Number(p?.injection_depth ?? 0),
      order: i * 10,
      enabled: Boolean(p?.enabled ?? true),
      content: isMarker ? '' : String(p?.content ?? ''),
      marker: isMarker,
    }
  })

  // 3. 提取正则脚本（合并 extensions.regex_scripts + extensions.SPreset.RegexBinding.regexes）
  const regexScripts: RegexItem[] = []
  const extRegex = stJson.extensions?.regex_scripts
  if (Array.isArray(extRegex)) {
    extRegex.forEach((r: any, i: number) => regexScripts.push(convertStRegex(r, i)))
  }
  const spresetRegex = stJson.extensions?.SPreset?.RegexBinding?.regexes
  if (Array.isArray(spresetRegex)) {
    spresetRegex.forEach((r: any, i: number) =>
      regexScripts.push(convertStRegex(r, regexScripts.length + i))
    )
  }

  // 4. 提取 assistant_prefill
  const prefill = String(stJson.assistant_prefill ?? '')

  // 5. 生成 ID 和名称
  const baseName = fileName.replace(/\.json$/i, '')
  const id = `st-${baseName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${Date.now()}`

  return {
    id,
    name: baseName,
    prompts,
    worldbook: [],
    regexScripts,
    assistantPrefill: prefill,
    boundEndpointId: '',
    updatedAt: nowLabel(),
  }
}

async function handleStImport(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  let importedCount = 0
  for (const file of Array.from(files)) {
    try {
      const text = await file.text()
      const json = JSON.parse(text)

      // 检测是否为 ST 预设（有 prompts 数组 + prompt_order 或 ST 特征字段）
      const isSt =
        Array.isArray(json.prompts) &&
        json.prompts.some((p: any) => p?.identifier && typeof p?.injection_depth !== 'undefined')

      if (!isSt) {
        toast.error(`${file.name} 不是有效的 SillyTavern 预设文件`)
        continue
      }

      const preset = convertStPreset(json, file.name)

      // 保存到后端
      await api.post('/presets', {
        id: preset.id,
        name: preset.name,
        data: JSON.stringify(buildPresetData(preset)),
      })

      importedCount++
    } catch (err: any) {
      toast.error(`导入 ${file.name} 失败: ${err?.message ?? '解析错误'}`)
    }
  }

  // 清空 input 以便再次选择同文件
  input.value = ''

  if (importedCount > 0) {
    toast.success(`成功导入 ${importedCount} 个 SillyTavern 预设 😸`)
    await loadPresets()
  }
}

function addPrompt() {
  if (!activePreset.value) return
  const id = `prompt-${Date.now()}`
  activePreset.value.prompts.push({
    id,
    name: 'New Prompt',
    role: 'system',
    position: 'relative',
    depth: 0,
    order: activePreset.value.prompts.length * 10,
    enabled: true,
    content: '',
  })
  activePromptId.value = id
}

const hasSummarySlot = computed(() =>
  activePreset.value?.prompts.some((p) => p.id === 'summaryHistory') ?? false
)

function addSummaryPrompt() {
  if (!activePreset.value) return
  if (hasSummarySlot.value) {
    toast.info('该预设已包含 summaryHistory 条目')
    return
  }
  // 在 chatHistory 之前插入，如果没有 chatHistory 则插入到末尾
  const chatIdx = activePreset.value.prompts.findIndex((p) => p.id === 'chatHistory')
  const insertAt = chatIdx >= 0 ? chatIdx : activePreset.value.prompts.length
  const newItem: PromptItem = {
    id: 'summaryHistory',
    name: 'Summary',
    role: 'system',
    position: 'relative',
    depth: 0,
    order: insertAt * 10,
    enabled: true,
    content: '{{summaryContent}}',
  }
  activePreset.value.prompts.splice(insertAt, 0, newItem)
  // 重新排序 order
  activePreset.value.prompts.forEach((p, i) => { p.order = i * 10 })
  activePromptId.value = 'summaryHistory'
  toast.success('已添加 Summary 条目（需保存生效）')
}


function addRegexScript() {
  if (!activePreset.value) return
  const id = `regex-${Date.now()}`
  activePreset.value.regexScripts.push({
    id,
    name: 'New Regex',
    enabled: true,
    findRegex: '',
    replaceRegex: '',
    trimRegex: '',
    targets: ['slashCommands'],
    view: ['model'],
  })
  activeRegexId.value = id
}

function removeRegexScript() {
  if (!activePreset.value || !activeRegex.value) return
  if (!confirm(`删除正则「${activeRegex.value.name}」？`)) return
  activePreset.value.regexScripts = activePreset.value.regexScripts.filter(
    (r: RegexItem) => r.id !== activeRegex.value!.id
  )
  activeRegexId.value = activePreset.value.regexScripts[0]?.id ?? ''
}

function toggleInArray<T>(arr: T[], value: T) {
  const idx = arr.indexOf(value)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(value)
}

function addWbEntry() {
  if (!activePreset.value) return
  const id = `wb-${Date.now()}`
  activePreset.value.worldbook.push({
    id,
    name: '新条目',
    enabled: true,
    activationMode: 'keyword',
    key: '',
    secondaryKey: '',
    selectiveLogic: 'andAny',
    position: 'beforeChar',
    depth: 0,
    order: activePreset.value.worldbook.length * 10,
    probability: 100,
    content: '',
  })
  activeWbId.value = id
}

function removeWbEntry() {
  if (!activePreset.value || !activeWbEntry.value) return
  activePreset.value.worldbook = activePreset.value.worldbook.filter(
    (e: WbEntry) => e.id !== activeWbEntry.value!.id
  )
  activeWbId.value = activePreset.value.worldbook[0]?.id ?? ''
}

// 世界书激活测试
const testInput = ref('今天我们去新星港夜市看看。')
const testHits = computed(() => {
  const text = testInput.value.trim()
  if (!text) return []
  return activeWb.value.filter((entry: WbEntry) => {
    if (!entry.enabled) return false
    if (entry.activationMode === 'always') return true
    if (entry.activationMode === 'vector') return false
    const keys = entry.key
      .split(',')
      .map((v: string) => v.trim())
      .filter(Boolean)
    return keys.some((k: string) => text.includes(k))
  })
})

onMounted(loadPresets)
</script>

<template>
  <section class="preset-layout">
    <!-- 左栏：预设列表 -->
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">预设列表</div>
          <div class="panel-subtitle">预设 = Prompts + 世界书 + 正则 + 预填充</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost" :disabled="loading" @click="loadPresets">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
          <button class="stellar-button" @click="triggerStImport" title="导入 SillyTavern 预设 JSON">
            导入ST
          </button>
          <button class="stellar-button" @click="createPreset">新建</button>
          <input
            ref="stImportInput"
            type="file"
            accept=".json"
            multiple
            style="display: none;"
            @change="handleStImport"
          />
        </div>
      </div>
      <div class="panel-body stack">
        <div v-if="presets.length === 0" class="muted">暂无预设，点击「新建」开始</div>
        <button
          v-for="item in presets"
          :key="item.id"
          class="nav-item"
          :class="{ 'router-link-active': item.id === activePresetId }"
          @click="selectPreset(item.id)"
        >
          <div class="split">
            <span>{{ item.name }}</span>
            <span class="badge">
              {{ item.prompts.length }}P · {{ item.worldbook.length }}W
            </span>
          </div>
          <div class="muted" style="margin-top: 4px; font-size: 11px;">
            更新于 {{ item.updatedAt }}
          </div>
        </button>
      </div>
    </div>

    <!-- 右栏：编辑区 -->
    <div class="stack" v-if="activePreset">
      <!-- Tab 切换栏 -->
      <div class="stellar-panel">
        <div class="panel-header">
          <div style="flex: 1;">
            <div class="split" style="gap: 8px;">
              <input
                class="stellar-input preset-name-input"
                :value="activePreset.name"
                @input="(e) => updatePresetName((e.target as HTMLInputElement).value)"
                placeholder="预设名称"
              />
            </div>
            <div class="panel-subtitle">主提示词 / 世界书 / 正则 / 预填充一体化配置</div>
          </div>
          <div class="split">
            <button class="stellar-button ghost" :disabled="!activePreset" @click="exportPreset">
              导出
            </button>
            <button class="stellar-button ghost" :disabled="!activePreset" @click="copyPreset">
              复制
            </button>
            <button class="stellar-button danger" @click="deletePreset">删除预设</button>
            <button class="stellar-button" :disabled="saving || !activePreset" @click="savePreset">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
        <div class="panel-body">
          <div class="split" style="flex-wrap: wrap; gap: 6px;">
            <button
              class="nav-item"
              style="max-width: 130px; text-align: center;"
              :class="{ 'router-link-active': activeTab === 'prompts' }"
              @click="activeTab = 'prompts'"
            >
              Prompts ({{ activePreset.prompts.length }})
            </button>
            <button
              class="nav-item"
              style="max-width: 130px; text-align: center;"
              :class="{ 'router-link-active': activeTab === 'worldbook' }"
              @click="activeTab = 'worldbook'"
            >
              世界书 ({{ activePreset.worldbook.length }})
            </button>
            <button
              class="nav-item"
              style="max-width: 130px; text-align: center;"
              :class="{ 'router-link-active': activeTab === 'regex' }"
              @click="activeTab = 'regex'"
            >
              正则 ({{ activePreset.regexScripts.length }})
            </button>
            <button
              class="nav-item"
              style="max-width: 130px; text-align: center;"
              :class="{ 'router-link-active': activeTab === 'settings' }"
              @click="activeTab = 'settings'"
            >
              设置
            </button>
          </div>
        </div>
      </div>


      <!-- TAB: Prompts -->
      <div class="stellar-panel" v-if="activeTab === 'prompts'">
        <div class="panel-body stack">
          <div class="grid-2 prompt-grid">
            <div class="stack prompt-list-col">
              <div class="split">
                <span class="muted">Prompt 列表（拖拽排序 · 条目内开关/删除）</span>
                <div class="split" style="gap: 4px;">
                  <button
                    v-if="!hasSummarySlot"
                    class="stellar-button"
                    style="font-size: 11px; padding: 4px 8px;"
                    @click="addSummaryPrompt"
                    title="添加 summaryHistory 条目，用于注入对话总结"
                  >
                    + 总结条目
                  </button>
                  <button class="stellar-button ghost" @click="addPrompt">新增</button>
                </div>
              </div>
              <div class="prompt-list-scroll">
                <DraggableList
                  :model-value="promptDraggableItems"
                  :show-toggle="true"
                  :show-delete="true"
                  @update:model-value="onPromptReorder"
                  @select="(item: DraggableItem) => (activePromptId = item.id)"
                  @toggle="onPromptToggle"
                  @delete="onPromptDelete"
                />
              </div>
            </div>

            <div class="stack prompt-detail-col" v-if="activePrompt">
              <span class="muted">Prompt 详情</span>

              <div class="grid-2">
                <label class="stack">
                  <span class="muted">名称</span>
                  <input class="stellar-input" v-model="activePrompt.name" />
                </label>
                <label class="stack">
                  <span class="muted">Identifier</span>
                  <input class="stellar-input" v-model="activePrompt.id" />
                </label>
                <label class="stack">
                  <span class="muted">Role</span>
                  <select class="stellar-select" v-model="activePrompt.role">
                    <option value="system">system</option>
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                  </select>
                </label>
                <label class="stack">
                  <span class="muted">Position</span>
                  <select class="stellar-select" v-model="activePrompt.position">
                    <option value="relative">relative</option>
                    <option value="fixed">fixed</option>
                  </select>
                </label>
                <label class="stack">
                  <span class="muted">Depth</span>
                  <input
                    class="stellar-input"
                    type="number"
                    v-model.number="activePrompt.depth"
                  />
                </label>
                <label class="stack">
                  <span class="muted">Order</span>
                  <input
                    class="stellar-input"
                    type="number"
                    v-model.number="activePrompt.order"
                  />
                </label>
              </div>

              <label class="stack">
                <span class="muted">Content</span>
                <textarea
                  class="stellar-textarea"
                  v-model="activePrompt.content"
                  rows="8"
                  placeholder="输入提示词内容，支持 {{char}} / {{user}} / {{getvar::name}} 宏。"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB: WorldBook -->
      <div class="stellar-panel" v-if="activeTab === 'worldbook'">
        <div class="panel-body stack">
          <div class="grid-2">
            <div class="stack">
              <div class="split">
                <span class="muted">世界书条目</span>
                <div class="split">
                  <button class="stellar-button ghost" @click="addWbEntry">新增</button>
                  <button
                    class="stellar-button danger"
                    @click="removeWbEntry"
                    :disabled="!activeWbEntry"
                  >
                    删除
                  </button>
                </div>
              </div>
              <button
                v-for="entry in activeWb"
                :key="entry.id"
                class="nav-item"
                :class="{ 'router-link-active': entry.id === activeWbId }"
                @click="activeWbId = entry.id"
              >
                <div class="split">
                  <span>{{ entry.name }}</span>
                  <span class="badge" :class="entry.enabled ? 'success' : 'danger'">
                    {{ entry.activationMode }}
                  </span>
                </div>
                <div class="muted" style="margin-top: 4px; font-size: 11px;">
                  {{ entry.position }} / p={{ entry.probability }}%
                </div>
              </button>
            </div>

            <div class="stack" v-if="activeWbEntry">
              <label class="stack">
                <span class="muted">条目名称</span>
                <input class="stellar-input" v-model="activeWbEntry.name" />
              </label>

              <div class="grid-2">
                <label class="stack">
                  <span class="muted">Activation</span>
                  <select class="stellar-select" v-model="activeWbEntry.activationMode">
                    <option value="always">always</option>
                    <option value="keyword">keyword</option>
                    <option value="vector">vector</option>
                  </select>
                </label>
                <label class="stack">
                  <span class="muted">Selective Logic</span>
                  <select class="stellar-select" v-model="activeWbEntry.selectiveLogic">
                    <option value="andAny">andAny</option>
                    <option value="andAll">andAll</option>
                    <option value="notAny">notAny</option>
                    <option value="notAll">notAll</option>
                  </select>
                </label>
                <label class="stack">
                  <span class="muted">Position</span>
                  <input class="stellar-input" v-model="activeWbEntry.position" />
                </label>
                <label class="stack">
                  <span class="muted">Probability</span>
                  <input
                    class="stellar-input"
                    type="number"
                    v-model.number="activeWbEntry.probability"
                  />
                </label>
                <label class="stack">
                  <span class="muted">Depth</span>
                  <input
                    class="stellar-input"
                    type="number"
                    v-model.number="activeWbEntry.depth"
                  />
                </label>
                <label class="stack">
                  <span class="muted">Order</span>
                  <input
                    class="stellar-input"
                    type="number"
                    v-model.number="activeWbEntry.order"
                  />
                </label>
              </div>

              <label class="stack">
                <span class="muted">关键词（逗号分隔）</span>
                <input class="stellar-input" v-model="activeWbEntry.key" />
              </label>
              <label class="stack">
                <span class="muted">次关键词（逗号分隔）</span>
                <input class="stellar-input" v-model="activeWbEntry.secondaryKey" />
              </label>
              <label class="stack">
                <span class="muted">内容</span>
                <textarea class="stellar-textarea" v-model="activeWbEntry.content" rows="6" />
              </label>
            </div>
          </div>

          <!-- 激活测试 -->
          <div class="stellar-panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">激活测试</div>
                <div class="panel-subtitle">输入上下文，实时查看命中的 keyword 条目</div>
              </div>
              <span class="badge">{{ testHits.length }} hits</span>
            </div>
            <div class="panel-body stack">
              <textarea class="stellar-textarea" v-model="testInput" rows="3" />
              <div class="split" style="flex-wrap: wrap;">
                <div v-for="hit in testHits" :key="hit.id" class="badge success">
                  {{ hit.name }} · {{ hit.activationMode }} · {{ hit.position }}
                </div>
                <div v-if="testHits.length === 0" class="muted">当前无命中条目</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB: Regex -->
      <div class="stellar-panel" v-if="activeTab === 'regex'">
        <div class="panel-body stack">
          <div class="grid-2">
            <!-- 左：列表 -->
            <div class="stack">
              <div class="split">
                <span class="muted">正则脚本列表</span>
                <div class="split">
                  <button class="stellar-button ghost" @click="addRegexScript">新增</button>
                  <button
                    class="stellar-button danger"
                    @click="removeRegexScript"
                    :disabled="!activeRegex"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div class="muted" v-if="activePreset.regexScripts.length === 0">
                当前预设无正则脚本
              </div>
              <button
                v-for="rs in activePreset.regexScripts"
                :key="rs.id"
                class="nav-item"
                :class="{ 'router-link-active': rs.id === activeRegexId }"
                @click="activeRegexId = rs.id"
              >
                <div class="split">
                  <span>{{ rs.name }}</span>
                  <span class="badge" :class="rs.enabled ? 'success' : 'danger'">
                    {{ rs.enabled ? 'on' : 'off' }}
                  </span>
                </div>
                <div class="muted" style="margin-top: 4px; font-size: 11px;">
                  {{ rs.targets.join(', ') }} · {{ rs.view.join(', ') }}
                </div>
              </button>
            </div>

            <!-- 右：编辑 -->
            <div class="stack" v-if="activeRegex">
              <div class="grid-2">
                <label class="stack">
                  <span class="muted">名称</span>
                  <input class="stellar-input" v-model="activeRegex.name" />
                </label>
                <label class="stack">
                  <span class="muted">ID</span>
                  <input class="stellar-input" v-model="activeRegex.id" />
                </label>
                <label class="stack">
                  <span class="muted">Find Regex</span>
                  <input class="stellar-input" v-model="activeRegex.findRegex" />
                </label>
                <label class="stack">
                  <span class="muted">Replace</span>
                  <input class="stellar-input" v-model="activeRegex.replaceRegex" />
                </label>
              </div>

              <label class="stack">
                <span class="muted">Trim（每行一条）</span>
                <textarea class="stellar-textarea" v-model="activeRegex.trimRegex" rows="2" />
              </label>

              <div class="grid-2">
                <div class="stack">
                  <span class="muted">Targets</span>
                  <div class="split" style="flex-wrap: wrap;">
                    <label class="badge" v-for="t in ['userInput','aiOutput','slashCommands','worldBook','reasoning']" :key="t">
                      <input
                        type="checkbox"
                        :checked="activeRegex.targets.includes(t)"
                        @change="toggleInArray(activeRegex!.targets, t)"
                      />
                      {{ t }}
                    </label>
                  </div>
                </div>
                <div class="stack">
                  <span class="muted">View</span>
                  <div class="split">
                    <label class="badge">
                      <input type="checkbox" :checked="activeRegex.view.includes('user')" @change="toggleInArray(activeRegex!.view, 'user')" />
                      user
                    </label>
                    <label class="badge">
                      <input type="checkbox" :checked="activeRegex.view.includes('model')" @change="toggleInArray(activeRegex!.view, 'model')" />
                      model
                    </label>
                  </div>
                </div>
              </div>

              <label class="badge" style="cursor: pointer;">
                <input type="checkbox" v-model="activeRegex.enabled" />
                启用
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB: Settings -->
      <div class="stellar-panel" v-if="activeTab === 'settings'">
        <div class="panel-body stack">
          <div class="grid-2">
            <label class="stack">
              <span class="muted">预设名称</span>
              <input
                class="stellar-input"
                :value="activePreset.name"
                @input="(e) => updatePresetName((e.target as HTMLInputElement).value)"
              />
            </label>
            <label class="stack">
              <span class="muted">ID</span>
              <input class="stellar-input" :value="activePreset.id" disabled />
            </label>
            <label class="stack">
              <span class="muted">绑定模型端点（切换预设时可自动应用）</span>
              <select class="stellar-select" v-model="activePreset.boundEndpointId">
                <option value="">（不绑定）</option>
                <option v-for="ep in endpointOptions" :key="ep.id" :value="ep.id">
                  {{ ep.name }} · {{ ep.model }}
                </option>
              </select>
            </label>
          </div>

          <label class="stack">
            <span class="muted">Assistant 预填充（Prefill）</span>
            <textarea
              class="stellar-textarea"
              v-model="activePreset.assistantPrefill"
              rows="4"
              placeholder="预填充内容，会作为最后一条 role:assistant 消息追加。留空则不使用。"
            />
          </label>

          <div class="muted">
            预填充会在最终提示词末尾添加一条 assistant 消息，
            引导模型以指定开头继续生成。留空则不使用此功能。
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.preset-layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 12px;
}

.preset-name-input {
  font-size: 16px;
  font-weight: 600;
  max-width: 320px;
}

.prompt-grid {
  align-items: start;
}

.prompt-list-col {
  position: sticky;
  top: 0;
}

.prompt-list-scroll {
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
}

.prompt-detail-col {
  position: sticky;
  top: 0;
  max-height: 80vh;
  overflow-y: auto;
}

@media (max-width: 1100px) {
  .preset-layout {
    grid-template-columns: 280px minmax(0, 1fr);
  }
}

@media (max-width: 960px) {
  .preset-layout {
    grid-template-columns: 1fr;
  }
}
</style>