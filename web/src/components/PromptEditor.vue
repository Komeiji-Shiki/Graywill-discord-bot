<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  modelValue: string
  label?: string
  placeholder?: string
  readonly?: boolean
  rows?: number
  monospace?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: 'Prompt',
  placeholder: '',
  readonly: false,
  rows: 10,
  monospace: true,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const classes = computed(() => ({
  'stellar-textarea': true,
  monospace: props.monospace,
}))

function onInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <label class="stack">
    <span class="muted">{{ label }}</span>
    <textarea
      :class="classes"
      :value="modelValue"
      :readonly="readonly"
      :rows="rows"
      :placeholder="placeholder"
      @input="onInput"
    />
  </label>
</template>

<style scoped>
.monospace {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
</style>