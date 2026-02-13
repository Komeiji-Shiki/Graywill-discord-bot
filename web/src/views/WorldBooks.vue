<script setup lang="ts">
import { computed, ref } from 'vue'

type ActivationMode = 'always' | 'keyword' | 'vector'
type SelectiveLogic = 'andAny' | 'andAll' | 'notAny' | 'notAll'

interface WorldBookEntryItem {
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

interface WorldBookItem {
  id: string
  name: string
  entries: WorldBookEntryItem[]
  updatedAt: string
}

const worldbooks = ref<WorldBookItem[]>([
  {
    id: 'wb-main',
    name: 'Main Lore',
    updatedAt: '2026-02-10 18:20',
    entries: [
      {
        id: 'wb-e1',
        name: '城市设定',
        enabled: true,
        activationMode: 'keyword',
        key: '新星港, 夜市',
        secondaryKey: '港口',
        selectiveLogic: 'andAny',
        position: 'beforeChar',
        depth: 0,
        order: 10,
        probability: 100,
        content: '故事发生在新星港，夜市是重要社交场景。',
      },
      {
        id: 'wb-e2',
        name: '固定注入-世界规则',
        enabled: true,
        activationMode: 'always',
        key: '',
        secondaryKey: '',
        selectiveLogic: 'andAny',
        position: 'fixed',
        depth: 1,
        order: 100,
        probability: 100,
        content: '魔法体系遵循等价交换原则。',
      },
    ],
  },
])

const activeWbId = ref(worldbooks.value[0]?.id ?? '')
const activeEntryId = ref(worldbooks.value[0]?.entries[0]?.id ?? '')
const testInput = ref('今天我们去新星港夜市看看。')

const activeWb = computed(
  () => worldbooks.value.find((w: WorldBookItem) => w.id === activeWbId.value) ?? null
)

const activeEntries = computed(() => activeWb.value?.entries ?? [])

const activeEntry = computed(
  () => activeEntries.value.find((e: WorldBookEntryItem) => e.id === activeEntryId.value) ?? null
)

function selectWorldBook(id: string) {
  activeWbId.value = id
  activeEntryId.value = worldbooks.value.find((w: WorldBookItem) => w.id === id)?.entries[0]?.id ?? ''
}

function addEntry() {
  if (!activeWb.value) return
  const id = `entry-${Date.now()}`
  activeWb.value.entries.push({
    id,
    name: '新条目',
    enabled: true,
    activationMode: 'keyword',
    key: '',
    secondaryKey: '',
    selectiveLogic: 'andAny',
    position: 'beforeChar',
    depth: 0,
    order: activeWb.value.entries.length * 10,
    probability: 100,
    content: '',
  })
  activeEntryId.value = id
}

const testHits = computed(() => {
  const text = testInput.value.trim()
  if (!text) return []
  return activeEntries.value.filter((entry: WorldBookEntryItem) => {
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
</script>

<template>
  <section class="grid-2">
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">世界书文件</div>
          <div class="panel-subtitle">多文件输入归一化后参与激活与注入</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost">导入</button>
          <button class="stellar-button">新建</button>
        </div>
      </div>
      <div class="panel-body stack">
        <button
          v-for="item in worldbooks"
          :key="item.id"
          class="nav-item"
          :class="{ 'router-link-active': item.id === activeWbId }"
          @click="selectWorldBook(item.id)"
        >
          <div class="split">
            <span>{{ item.name }}</span>
            <span class="badge">{{ item.entries.length }} entries</span>
          </div>
          <div class="muted" style="margin-top: 4px; font-size: 11px;">更新于 {{ item.updatedAt }}</div>
        </button>
      </div>
    </div>

    <div class="stellar-panel" v-if="activeWb">
      <div class="panel-header">
        <div>
          <div class="panel-title">编辑世界书 · {{ activeWb.name }}</div>
          <div class="panel-subtitle">activation / selectiveLogic / depth / position</div>
        </div>
        <div class="split">
          <button class="stellar-button ghost" @click="addEntry">新增条目</button>
          <button class="stellar-button">保存</button>
        </div>
      </div>
      <div class="panel-body stack">
        <div class="grid-2">
          <div class="stack">
            <span class="muted">条目列表</span>
            <button
              v-for="entry in activeEntries"
              :key="entry.id"
              class="nav-item"
              :class="{ 'router-link-active': entry.id === activeEntryId }"
              @click="activeEntryId = entry.id"
            >
              <div class="split">
                <span>{{ entry.name }}</span>
                <span class="badge" :class="entry.enabled ? 'success' : 'danger'">
                  {{ entry.enabled ? 'on' : 'off' }}
                </span>
              </div>
              <div class="muted" style="margin-top: 4px; font-size: 11px;">
                {{ entry.activationMode }} / {{ entry.position }} / p={{ entry.probability }}%
              </div>
            </button>
          </div>

          <div class="stack" v-if="activeEntry">
            <label class="stack">
              <span class="muted">条目名称</span>
              <input class="stellar-input" v-model="activeEntry.name" />
            </label>

            <div class="grid-2">
              <label class="stack">
                <span class="muted">Activation</span>
                <select class="stellar-select" v-model="activeEntry.activationMode">
                  <option value="always">always</option>
                  <option value="keyword">keyword</option>
                  <option value="vector">vector</option>
                </select>
              </label>

              <label class="stack">
                <span class="muted">Selective Logic</span>
                <select class="stellar-select" v-model="activeEntry.selectiveLogic">
                  <option value="andAny">andAny</option>
                  <option value="andAll">andAll</option>
                  <option value="notAny">notAny</option>
                  <option value="notAll">notAll</option>
                </select>
              </label>

              <label class="stack">
                <span class="muted">Position</span>
                <input class="stellar-input" v-model="activeEntry.position" />
              </label>

              <label class="stack">
                <span class="muted">Probability</span>
                <input class="stellar-input" type="number" v-model.number="activeEntry.probability" />
              </label>

              <label class="stack">
                <span class="muted">Depth</span>
                <input class="stellar-input" type="number" v-model.number="activeEntry.depth" />
              </label>

              <label class="stack">
                <span class="muted">Order</span>
                <input class="stellar-input" type="number" v-model.number="activeEntry.order" />
              </label>
            </div>

            <label class="stack">
              <span class="muted">关键词（逗号分隔）</span>
              <input class="stellar-input" v-model="activeEntry.key" />
            </label>

            <label class="stack">
              <span class="muted">次关键词（逗号分隔）</span>
              <input class="stellar-input" v-model="activeEntry.secondaryKey" />
            </label>

            <label class="stack">
              <span class="muted">内容</span>
              <textarea class="stellar-textarea" v-model="activeEntry.content" />
            </label>
          </div>
        </div>

        <div class="stellar-panel">
          <div class="panel-header">
            <div>
              <div class="panel-title">激活测试</div>
              <div class="panel-subtitle">输入上下文，实时查看命中的 keyword 条目</div>
            </div>
            <span class="badge">{{ testHits.length }} hits</span>
          </div>
          <div class="panel-body stack">
            <textarea class="stellar-textarea" v-model="testInput" />
            <div class="stack">
              <div v-for="hit in testHits" :key="hit.id" class="badge success">
                {{ hit.name }} · {{ hit.activationMode }} · {{ hit.position }}
              </div>
              <div v-if="testHits.length === 0" class="muted">当前无命中条目</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>