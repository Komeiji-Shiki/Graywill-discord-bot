<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

interface VariableItem {
  key: string
  value: string
  scope: 'global' | 'channel'
}

const api = useApi()
const toast = useToast()

const channelId = ref('')
const globalVariables = ref<VariableItem[]>([])
const channelVariables = ref<VariableItem[]>([])

const macroPreview = ref(
  '当前章节={{getglobalvar::story_phase}}，频道主题={{getvar::topic}}，情绪={{getvar::mood}}。'
)

const previewOutput = computed(() => {
  let out = macroPreview.value
  const globalMap = Object.fromEntries(
    globalVariables.value.map((v: VariableItem): [string, string] => [v.key, v.value])
  )
  const localMap = Object.fromEntries(
    channelVariables.value.map((v: VariableItem): [string, string] => [v.key, v.value])
  )

  out = out.replace(/\{\{\s*getglobalvar::([^}]+)\s*\}\}/gi, (_m: string, name: string) => {
    return String(globalMap[name.trim()] ?? '')
  })

  out = out.replace(/\{\{\s*getvar::([^}]+)\s*\}\}/gi, (_m: string, name: string) => {
    return String(localMap[name.trim()] ?? '')
  })

  return out
})

async function loadGlobalVariables() {
  try {
    const data = await api.get<Record<string, string>>('/variables/global')
    globalVariables.value = Object.entries(data).map(([key, value]) => ({
      key, value, scope: 'global' as const,
    }))
  } catch (err: any) {
    toast.error(err?.message || '加载全局变量失败')
  }
}

async function loadChannelVariables() {
  if (!channelId.value.trim()) return
  try {
    const data = await api.get<Record<string, string>>(`/variables/channel/${channelId.value}`)
    channelVariables.value = Object.entries(data).map(([key, value]) => ({
      key, value, scope: 'channel' as const,
    }))
  } catch (err: any) {
    toast.error(err?.message || '加载频道变量失败')
  }
}

async function saveGlobalVariables() {
  try {
    const payload = globalVariables.value
      .filter((v) => v.key.trim())
      .map((v) => ({ key: v.key, value: v.value }))
    await api.put('/variables/global', payload)
    toast.success('全局变量已保存')
  } catch (err: any) {
    toast.error(err?.message || '保存全局变量失败')
  }
}

async function saveChannelVariables() {
  if (!channelId.value.trim()) {
    toast.warning('请先输入 Channel ID')
    return
  }
  try {
    const payload = channelVariables.value
      .filter((v) => v.key.trim())
      .map((v) => ({ key: v.key, value: v.value }))
    await api.put(`/variables/channel/${channelId.value}`, payload)
    toast.success('频道变量已保存')
  } catch (err: any) {
    toast.error(err?.message || '保存频道变量失败')
  }
}

function addGlobal() {
  globalVariables.value.push({ key: 'new_key', value: '', scope: 'global' })
}

function addChannel() {
  channelVariables.value.push({ key: 'new_key', value: '', scope: 'channel' })
}

function removeGlobal(index: number) {
  globalVariables.value.splice(index, 1)
}

function removeChannel(index: number) {
  channelVariables.value.splice(index, 1)
}

onMounted(loadGlobalVariables)
</script>

<template>
  <section class="stack">
    <div class="grid-2">
      <div class="stellar-panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Global Variables</div>
            <div class="panel-subtitle">
              跨频道持久化，映射 <span class="kbd" v-pre>{{getglobalvar::name}}</span>
            </div>
          </div>
          <button class="stellar-button ghost" @click="addGlobal">新增</button>
        </div>
        <div class="panel-body stack">
          <div v-for="(item, idx) in globalVariables" :key="item.key + '-' + idx" class="grid-3">
            <input class="stellar-input" v-model="item.key" placeholder="key" />
            <input class="stellar-input" v-model="item.value" placeholder="value" />
            <button class="stellar-button danger" @click="removeGlobal(idx)">删除</button>
          </div>
          <button class="stellar-button" @click="saveGlobalVariables">保存全局变量</button>
        </div>
      </div>

      <div class="stellar-panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Channel Variables</div>
            <div class="panel-subtitle">
              频道 {{ channelId }} 局部变量，映射 <span class="kbd" v-pre>{{getvar::name}}</span>
            </div>
          </div>
          <button class="stellar-button ghost" @click="addChannel">新增</button>
        </div>
        <div class="panel-body stack">
          <label class="stack">
            <span class="muted">Channel ID</span>
            <input class="stellar-input" v-model="channelId" @change="loadChannelVariables" placeholder="输入频道 ID 后回车加载" />
          </label>
          <div v-for="(item, idx) in channelVariables" :key="item.key + '-' + idx" class="grid-3">
            <input class="stellar-input" v-model="item.key" placeholder="key" />
            <input class="stellar-input" v-model="item.value" placeholder="value" />
            <button class="stellar-button danger" @click="removeChannel(idx)">删除</button>
          </div>
          <button class="stellar-button" @click="saveChannelVariables">保存频道变量</button>
        </div>
      </div>
    </div>

    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">宏替换预览</div>
          <div class="panel-subtitle">快速验证变量宏在提示词中的展开结果</div>
        </div>
        <span class="badge warning">Preview</span>
      </div>
      <div class="panel-body stack">
        <label class="stack">
          <span class="muted">输入模板</span>
          <textarea class="stellar-textarea" v-model="macroPreview" />
        </label>
        <label class="stack">
          <span class="muted">展开结果</span>
          <textarea class="stellar-textarea" :value="previewOutput" readonly />
        </label>
      </div>
    </div>
  </section>
</template>