<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  label?: string
  accept?: string
  multiple?: boolean
  hint?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: '导入文件',
  accept: '.json,.png',
  multiple: false,
  hint: '支持拖拽或点击选择文件',
  disabled: false,
})

const emit = defineEmits<{
  (e: 'select', files: File[]): void
}>()

const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function normalizeFiles(list: FileList | null): File[] {
  if (!list) return []
  return Array.from(list)
}

function onInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  const files = normalizeFiles(target.files)
  if (files.length > 0) emit('select', files)
  target.value = ''
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  dragOver.value = false
  if (props.disabled) return
  const files = normalizeFiles(event.dataTransfer?.files ?? null)
  if (files.length > 0) emit('select', files)
}

function openPicker() {
  if (props.disabled) return
  fileInput.value?.click()
}
</script>

<template>
  <div
    class="stellar-panel"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop="onDrop"
  >
    <div class="panel-body stack">
      <div class="split">
        <div>
          <div class="panel-title">{{ label }}</div>
          <div class="panel-subtitle">{{ hint }}</div>
        </div>
        <button class="stellar-button" :disabled="disabled" @click="openPicker">选择文件</button>
      </div>

      <div
        class="nav-item"
        :class="{ 'router-link-active': dragOver }"
        style="text-align: center; padding: 22px 12px;"
      >
        <div class="muted">将文件拖放到此处，或点击右上按钮选择</div>
        <div class="muted" style="margin-top: 6px; font-size: 11px;">Accept: {{ accept }}</div>
      </div>

      <input
        ref="fileInput"
        type="file"
        :accept="accept"
        :multiple="multiple"
        style="display: none;"
        @change="onInputChange"
      />
    </div>
  </div>
</template>