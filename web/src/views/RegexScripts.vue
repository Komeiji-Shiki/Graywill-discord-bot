<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

type RegexTarget = 'userInput' | 'aiOutput' | 'slashCommands' | 'worldBook' | 'reasoning'
type RegexView = 'user' | 'model'

interface RegexScriptItem {
  id: string
  name: string
  enabled: boolean
  findRegex: string
  replaceRegex: string
  trimRegex: string
  targets: string[]
  view: string[]
}

interface PresetOption {
  id: string
  name: string
  regexScripts: RegexScriptItem[]
  /** 完整预设 data JSON（用于保存时回写） */
  _rawData: any
}

interface BackendPresetRecord {
  id: string
  name: string
  data: string
  updatedAt: string
}

const api = useApi()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)

const presets = ref<PresetOption[]>([])
const selectedPresetId = ref('')

const selectedPreset = computed(() =>
  presets.value.find((p) => p.id === selectedPresetId.value) ?? null
)

const scripts = computed(() => selectedPreset.value?.regexScripts ?? [])

const activeId = ref('')
const active = computed(() => scripts.value.find((s) => s.id === activeId.value) ?? null)

const testInput = ref('I like apple and <tag>secret</tag>.')
const testTarget = ref<RegexTarget>('aiOutput')
const testView = ref<RegexView>('user')

// 切换脚本时自动将测试器 target/view 设为脚本的第一个 target/view
watch(active, (s) => {
  if (!s) return
  if (s.targets.length > 0 && !s.targets.includes(testTarget.value)) {
    testTarget.value = s.targets[0] as RegexTarget
  }
  if (s.view.length > 0 && !s.view.includes(testView.value)) {
    testView.value = s.view[0] as RegexView
  }
})

const testOutput = computed(() => {
  if (!active.value?.enabled) return testInput.value

  let out = testInput.value
  const script = active.value

  if (!script.targets.includes(testTarget.value)) return out
  // view 为空时视为对所有视角生效（兼容 ST 导入）
  if (script.view.length > 0 && !script.view.includes(testView.value)) return out

  try {
    const regex = (() => {
      const m = script.findRegex.match(/^\/(.+)\/([gimsuy]*)$/)
      if (m) return new RegExp(m[1], m[2])
      return new RegExp(script.findRegex, 'g')
    })()

    out = out.replace(regex, (...args: any[]) => {
      const match = String(args[0] ?? '')
      let normalized = match

      script.trimRegex
        .split('\n')
        .map((x: string) => x.trim())
        .filter(Boolean)
        .forEach((x: string) => {
          normalized = normalized.split(x).join('')
        })

      return script.replaceRegex.replace(/\{\{match\}\}/g, normalized).replace(/\$&/g, normalized)
    })
  } catch {
    return '[Regex 解析失败，请检查 findRegex]'
  }

  return out
})

function parsePresetRegexScripts(rawData: any): RegexScriptItem[] {
  if (!rawData || !Array.isArray(rawData.regexScripts)) return []
  return rawData.regexScripts.map((x: any, i: number) => ({
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
}

async function loadPresets() {
  loading.value = true
  try {
    const rows = await api.get<BackendPresetRecord[]>('/presets')
    presets.value = rows.map((row) => {
      let rawData: any = {}
      try {
        rawData = JSON.parse(row.data)
      } catch { /* noop */ }
      return {
        id: row.id,
        name: row.name,
        regexScripts: parsePresetRegexScripts(rawData),
        _rawData: rawData,
      }
    })

    if (presets.value.length > 0 && !presets.value.some((x) => x.id === selectedPresetId.value)) {
      selectedPresetId.value = presets.value[0].id
    }
  } catch (err: any) {
    toast.error(err?.message || '加载预设失败')
  } finally {
    loading.value = false
  }
}

watch(selectedPresetId, () => {
  activeId.value = scripts.value[0]?.id ?? ''
})

function createScript() {
  if (!selectedPreset.value) {
    toast.error('请先选择一个预设')
    return
  }
  const id = `regex-${Date.now()}`
  selectedPreset.value.regexScripts.push({
    id,
    name: 'new-script',
    enabled: true,
    findRegex: '',
    replaceRegex: '',
    trimRegex: '',
    targets: ['slashCommands'],
    view: ['model'],
  })
  activeId.value = id
}

function removeScript() {
  if (!active.value || !selectedPreset.value) return
  if (!confirm(`删除正则「${active.value.name}」？`)) return
  selectedPreset.value.regexScripts = selectedPreset.value.regexScripts.filter(
    (s) => s.id !== active.value!.id
  )
  activeId.value = scripts.value[0]?.id ?? ''
}

async function saveToPreset() {
  if (!selectedPreset.value) return
  saving.value = true
  try {
    const preset = selectedPreset.value
    // 将编辑后的正则脚本写回 rawData
    preset._rawData.regexScripts = preset.regexScripts.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      findRegex: r.findRegex,
      replaceRegex: r.replaceRegex,
      trimRegex: r.trimRegex
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
      targets: r.targets,
      view: r.view,
      runOnEdit: false,
      macroMode: 'none',
      minDepth: null,
      maxDepth: null,
    }))

    await api.post('/presets', {
      id: preset.id,
      name: preset.name,
      data: JSON.stringify(preset._rawData),
    })

    toast.success(`正则脚本已保存到预设「${preset.name}」`)
  } catch (err: any) {
    toast.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function toggleInArray<T>(arr: T[], value: T) {
  const idx = arr.indexOf(value)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(value)
}

onMounted(loadPresets)
</script>

<template>
  <section class="grid-2">
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">Regex Scripts</div>
          <div class="panel-subtitle">选择预设 → 编辑其正则脚本</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost" @click="loadPresets" :disabled="loading">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
          <button class="stellar-button ghost" @click="createScript">新建</button>
          <button class="stellar-button danger" @click="removeScript" :disabled="!active">删除</button>
        </div>
      </div>
      <div class="panel-body stack">
        <!-- 预设选择 -->
        <label class="stack">
          <span class="muted">预设</span>
          <select class="stellar-select" v-model="selectedPresetId">
            <option v-for="p in presets" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.regexScripts.length }} 条正则)
            </option>
          </select>
        </label>

        <div class="muted" v-if="scripts.length === 0">当前预设无正则脚本</div>

        <button
          v-for="item in scripts"
          :key="item.id"
          class="nav-item"
          :class="{ 'router-link-active': item.id === activeId }"
          @click="activeId = item.id"
        >
          <div class="split">
            <span>{{ item.name }}</span>
            <span class="badge" :class="item.enabled ? 'success' : 'danger'">
              {{ item.enabled ? 'enabled' : 'disabled' }}
            </span>
          </div>
          <div class="muted" style="margin-top: 4px; font-size: 11px;">
            {{ item.targets.join(', ') }} · {{ item.view.join(', ') }}
          </div>
        </button>
      </div>
    </div>

    <div class="stack">
      <div class="stellar-panel" v-if="active">
        <div class="panel-header">
          <div>
            <div class="panel-title">编辑脚本 · {{ active.name }}</div>
            <div class="panel-subtitle">支持 `/pattern/flags` 与普通 pattern 两种写法</div>
          </div>
          <div class="split">
            <label class="badge">
              <input type="checkbox" v-model="active.enabled" />
              启用
            </label>
            <button class="stellar-button" :disabled="saving" @click="saveToPreset">
              {{ saving ? '保存中...' : '保存到预设' }}
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
              <span class="muted">ID</span>
              <input class="stellar-input" v-model="active.id" />
            </label>
          </div>

          <label class="stack">
            <span class="muted">Find Regex</span>
            <input class="stellar-input" v-model="active.findRegex" />
          </label>

          <label class="stack">
            <span class="muted">Replace Regex</span>
            <textarea class="stellar-textarea" v-model="active.replaceRegex" rows="4" style="min-height: 80px;" />
          </label>

          <label class="stack">
            <span class="muted">Trim（每行一条）</span>
            <textarea class="stellar-textarea" v-model="active.trimRegex" rows="2" />
          </label>

          <div class="grid-2">
            <div class="stack">
              <span class="muted">Targets</span>
              <div class="split" style="flex-wrap: wrap;">
                <label class="badge" v-for="t in ['userInput','aiOutput','slashCommands','worldBook','reasoning']" :key="t">
                  <input
                    type="checkbox"
                    :checked="active.targets.includes(t)"
                    @change="toggleInArray(active!.targets, t)"
                  />
                  {{ t }}
                </label>
              </div>
            </div>
            <div class="stack">
              <span class="muted">View</span>
              <div class="split">
                <label class="badge">
                  <input type="checkbox" :checked="active.view.includes('user')" @change="toggleInArray(active!.view, 'user')" />
                  user
                </label>
                <label class="badge">
                  <input type="checkbox" :checked="active.view.includes('model')" @change="toggleInArray(active!.view, 'model')" />
                  model
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="stellar-panel" v-if="active">
        <div class="panel-header">
          <div>
            <div class="panel-title">脚本测试器</div>
            <div class="panel-subtitle">
              输入测试文本，验证 <span class="kbd" v-pre>trim/{{match}}/$&</span> 行为
            </div>
          </div>
          <span class="badge">{{ testTarget }} · {{ testView }}</span>
        </div>
        <div class="panel-body stack">
          <div class="grid-2">
            <label class="stack">
              <span class="muted">Target</span>
              <select class="stellar-select" v-model="testTarget">
                <option value="userInput">userInput</option>
                <option value="aiOutput">aiOutput</option>
                <option value="slashCommands">slashCommands</option>
                <option value="worldBook">worldBook</option>
                <option value="reasoning">reasoning</option>
              </select>
            </label>
            <label class="stack">
              <span class="muted">View</span>
              <select class="stellar-select" v-model="testView">
                <option value="user">user</option>
                <option value="model">model</option>
              </select>
            </label>
          </div>
          <label class="stack">
            <span class="muted">输入</span>
            <textarea class="stellar-textarea" v-model="testInput" />
          </label>
          <label class="stack">
            <span class="muted">输出</span>
            <textarea class="stellar-textarea" :value="testOutput" readonly />
          </label>
        </div>
      </div>
    </div>
  </section>
</template>