<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../composables/useApi'
import { useToast } from '../composables/useToast'

interface CharacterCardData {
  avatar: string
  opening: string
  description: string
  worldbook: string
  presetHint: string
}

interface CharacterCardItem {
  id: string
  name: string
  data: CharacterCardData
  updatedAt: string
}

interface BackendCharacterRecord {
  id: string
  name: string
  data: string
  updatedAt: string
}

const api = useApi()
const toast = useToast()

const loading = ref(false)
const saving = ref(false)

const characters = ref<CharacterCardItem[]>([])
const activeId = ref('')

const active = computed(
  () => characters.value.find((item) => item.id === activeId.value) ?? null
)

function parseCharacterRecord(row: BackendCharacterRecord): CharacterCardItem {
  let data: CharacterCardData = { avatar: '', opening: '', description: '', worldbook: '', presetHint: '' }
  try {
    const parsed = JSON.parse(row.data)
    if (parsed && typeof parsed === 'object') {
      data = {
        avatar: String(parsed.avatar ?? ''),
        opening: String(parsed.opening ?? parsed.first_mes ?? ''),
        description: String(parsed.description ?? ''),
        worldbook: String(parsed.worldbook ?? ''),
        presetHint: String(parsed.presetHint ?? ''),
      }
    }
  } catch { /* ignore */ }
  return { id: row.id, name: row.name, data, updatedAt: row.updatedAt }
}

async function loadCharacters() {
  loading.value = true
  try {
    const rows = await api.get<BackendCharacterRecord[]>('/characters')
    characters.value = rows.map(parseCharacterRecord)
    if (characters.value.length > 0 && !characters.value.some((x) => x.id === activeId.value)) {
      activeId.value = characters.value[0].id
    }
    if (characters.value.length === 0) activeId.value = ''
  } catch (err: any) {
    toast.error(err?.message || '加载角色卡失败')
  } finally {
    loading.value = false
  }
}

async function saveCharacter() {
  if (!active.value) return
  saving.value = true
  try {
    await api.post('/characters', {
      id: active.value.id,
      name: active.value.name,
      data: JSON.stringify(active.value.data),
    })
    toast.success('角色卡已保存')
    const prevId = active.value.id
    await loadCharacters()
    activeId.value = prevId
  } catch (err: any) {
    toast.error(err?.message || '保存角色卡失败')
  } finally {
    saving.value = false
  }
}

function createCharacter() {
  const id = `char-${Date.now()}`
  characters.value.unshift({
    id,
    name: 'New Character',
    data: {
      avatar: '',
      opening: '',
      description: '',
      worldbook: '',
      presetHint: '',
    },
    updatedAt: new Date().toLocaleString('zh-CN'),
  })
  activeId.value = id
  toast.info('新角色卡为本地草稿，点击保存后写入后端')
}

async function removeCharacter() {
  if (!active.value) return
  try {
    await api.del(`/characters/${active.value.id}`)
    toast.success('角色卡已删除')
    await loadCharacters()
  } catch (err: any) {
    // 可能是本地草稿还没保存到后端
    characters.value = characters.value.filter((x) => x.id !== active.value!.id)
    activeId.value = characters.value[0]?.id ?? ''
    toast.warning(err?.message || '已从本地移除')
  }
}

onMounted(loadCharacters)
</script>

<template>
  <section class="grid-2">
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">角色卡列表</div>
          <div class="panel-subtitle">可绑定频道与预设，兼容酒馆角色卡导入</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost" :disabled="loading" @click="loadCharacters">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
          <button class="stellar-button" @click="createCharacter">新建</button>
        </div>
      </div>

      <div class="panel-body stack">
        <button
          v-for="item in characters"
          :key="item.id"
          class="nav-item"
          :class="{ 'router-link-active': item.id === activeId }"
          @click="activeId = item.id"
        >
          <div class="split">
            <span>{{ item.name }}</span>
            <span class="badge">{{ item.data.worldbook || 'No WB' }}</span>
          </div>
          <div class="muted" style="margin-top: 4px; font-size: 11px;">
            {{ item.data.presetHint || '未绑定预设' }} · {{ item.updatedAt }}
          </div>
        </button>
        <div v-if="characters.length === 0" class="muted">暂无角色卡</div>
      </div>
    </div>

    <div class="stellar-panel" v-if="active">
      <div class="panel-header">
        <div>
          <div class="panel-title">编辑角色卡 · {{ active.name }}</div>
          <div class="panel-subtitle">世界书、开场白、角色描述与默认语气配置</div>
        </div>
        <div class="split">
          <button class="stellar-button danger" @click="removeCharacter">删除</button>
          <button class="stellar-button" :disabled="saving" @click="saveCharacter">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>

      <div class="panel-body stack">
        <div class="grid-2">
          <label class="stack">
            <span class="muted">角色名</span>
            <input class="stellar-input" v-model="active.name" />
          </label>
          <label class="stack">
            <span class="muted">头像 URL</span>
            <input class="stellar-input" v-model="active.data.avatar" />
          </label>
        </div>

        <div class="split" style="align-items: flex-start;">
          <img
            v-if="active.data.avatar"
            :src="active.data.avatar"
            alt="avatar"
            style="width: 96px; height: 96px; border: 1px solid var(--edge-default); object-fit: cover;"
          />
          <label class="stack" style="flex: 1;">
            <span class="muted">绑定世界书</span>
            <input class="stellar-input" v-model="active.data.worldbook" placeholder="例如：Alice Lore" />
          </label>
          <label class="stack" style="flex: 1;">
            <span class="muted">推荐预设</span>
            <input class="stellar-input" v-model="active.data.presetHint" placeholder="例如：Default RP" />
          </label>
        </div>

        <label class="stack">
          <span class="muted">开场白（首条消息）</span>
          <textarea
            class="stellar-textarea"
            v-model="active.data.opening"
            placeholder="用于频道首次激活时作为角色第一句话。"
          />
        </label>

        <label class="stack">
          <span class="muted">角色描述</span>
          <textarea
            class="stellar-textarea"
            v-model="active.data.description"
            placeholder="用于人格设定与语气约束，可包含宏变量。"
          />
        </label>
      </div>
    </div>
  </section>
</template>