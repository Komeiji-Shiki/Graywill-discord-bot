<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Sortable from 'sortablejs'

export interface DraggableItem {
  id: string
  label: string
  subtitle?: string
  enabled?: boolean
}

interface Props {
  modelValue: DraggableItem[]
  disabled?: boolean
  showToggle?: boolean
  showDelete?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  showToggle: false,
  showDelete: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: DraggableItem[]): void
  (e: 'select', item: DraggableItem): void
  (e: 'toggle', item: DraggableItem): void
  (e: 'delete', item: DraggableItem): void
}>()

const rootEl = ref<HTMLElement | null>(null)
let sortable: Sortable | null = null

function cloneItems() {
  return props.modelValue.map((item) => ({ ...item }))
}

function move(array: DraggableItem[], from: number, to: number) {
  const next = [...array]
  const [target] = next.splice(from, 1)
  if (!target) return next
  next.splice(to, 0, target)
  return next
}

onMounted(() => {
  if (!rootEl.value) return
  sortable = Sortable.create(rootEl.value, {
    animation: 160,
    disabled: props.disabled,
    handle: '.drag-handle',
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    dragClass: 'drag-dragging',
    onEnd(event) {
      const from = event.oldIndex
      const to = event.newIndex
      if (from === undefined || to === undefined || from === to) return

      // ⭐ 关键修复：先恢复 DOM 到原位，再让 Vue 通过数据驱动重新渲染
      const el = event.item
      const parent = el.parentNode
      if (parent) {
        // 将 SortableJS 移动的节点放回原来的位置
        parent.removeChild(el)
        const ref = parent.children[from]
        if (ref) {
          parent.insertBefore(el, ref)
        } else {
          parent.appendChild(el)
        }
      }

      const next = move(cloneItems(), from, to)
      emit('update:modelValue', next)
    },
  })
})

watch(
  () => props.disabled,
  (v) => {
    sortable?.option('disabled', v)
  }
)

onBeforeUnmount(() => {
  sortable?.destroy()
  sortable = null
})
</script>

<template>
  <div ref="rootEl" class="drag-list stack">
    <div
      v-for="item in modelValue"
      :key="item.id"
      class="nav-item drag-item"
    >
      <div class="split">
        <span class="drag-item-label" @click="emit('select', item)">{{ item.label }}</span>
        <span class="split" style="gap: 4px;">
          <label
            v-if="showToggle"
            class="badge drag-toggle"
            :class="item.enabled === false ? 'danger' : 'success'"
            @click.stop
            :title="item.enabled === false ? '点击启用' : '点击禁用'"
          >
            <input
              type="checkbox"
              :checked="item.enabled !== false"
              @change.stop="emit('toggle', item)"
              style="margin: 0;"
            />
            {{ item.enabled === false ? 'off' : 'on' }}
          </label>
          <span
            v-else
            class="badge"
            :class="item.enabled === false ? 'danger' : 'success'"
          >
            {{ item.enabled === false ? 'off' : 'on' }}
          </span>
          <button
            v-if="showDelete"
            class="drag-delete-btn"
            title="删除此条目"
            @click.stop="emit('delete', item)"
          >
            ✕
          </button>
          <span class="drag-handle kbd" title="拖拽排序">⋮⋮</span>
        </span>
      </div>
      <div v-if="item.subtitle" class="muted" style="margin-top: 4px; font-size: 11px;" @click="emit('select', item)">
        {{ item.subtitle }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.drag-item {
  cursor: default;
}
.drag-item-label {
  cursor: pointer;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.drag-handle {
  cursor: grab;
  user-select: none;
}
.drag-toggle {
  cursor: pointer;
  user-select: none;
  gap: 3px;
}
.drag-delete-btn {
  background: none;
  border: 1px solid var(--edge-default, #555);
  border-radius: 4px;
  color: var(--text-muted, #888);
  font-size: 11px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.drag-delete-btn:hover {
  background: rgba(255, 60, 60, 0.2);
  border-color: rgba(255, 60, 60, 0.6);
  color: #f44;
}
.drag-ghost {
  opacity: 0.55;
}
.drag-chosen {
  border-color: var(--edge-focus);
}
.drag-dragging {
  transform: rotate(1deg);
}
</style>