<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  inputTokens?: number
  outputTokens?: number
  iterations?: number
  elapsedSeconds?: number
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  inputTokens: 0,
  outputTokens: 0,
  iterations: 0,
  elapsedSeconds: 0,
  compact: false,
})

const totalTokens = computed(() => props.inputTokens + props.outputTokens)

const metadataLine = computed(() => {
  const time = props.elapsedSeconds.toFixed(2)
  return `-# Time: ${time}s | Input: ${props.inputTokens}t | Output: ${props.outputTokens}t | Iterations: ${props.iterations}`
})

function fmt(n: number) {
  return Intl.NumberFormat('en-US').format(n)
}
</script>

<template>
  <div class="stellar-panel">
    <div class="panel-header">
      <div>
        <div class="panel-title">Token Telemetry</div>
        <div class="panel-subtitle">流式输出统计与元数据尾注预览</div>
      </div>
      <span class="badge warning">LIVE</span>
    </div>

    <div class="panel-body stack">
      <div class="grid-4" :class="{ 'grid-2': compact }">
        <article class="stat-card">
          <div class="stat-label">Input</div>
          <div class="stat-value">{{ fmt(inputTokens) }}<span class="muted"> t</span></div>
        </article>
        <article class="stat-card">
          <div class="stat-label">Output</div>
          <div class="stat-value">{{ fmt(outputTokens) }}<span class="muted"> t</span></div>
        </article>
        <article class="stat-card">
          <div class="stat-label">Total</div>
          <div class="stat-value">{{ fmt(totalTokens) }}<span class="muted"> t</span></div>
        </article>
        <article class="stat-card">
          <div class="stat-label">Iterations</div>
          <div class="stat-value">{{ fmt(iterations) }}</div>
        </article>
      </div>

      <div class="split">
        <span class="muted">Elapsed</span>
        <span class="kbd">{{ elapsedSeconds.toFixed(2) }}s</span>
      </div>

      <label class="stack">
        <span class="muted">Metadata Preview</span>
        <textarea class="stellar-textarea" :value="metadataLine" readonly rows="2" />
      </label>
    </div>
  </div>
</template>