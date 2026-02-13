<script setup lang="ts">
import { useToast } from '../composables/useToast'

const toast = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="item in toast.items"
          :key="item.id"
          class="toast-item"
          :class="item.level"
          @click="toast.remove(item.id)"
        >
          <span class="toast-icon">
            {{ item.level === 'success' ? '✓' : item.level === 'error' ? '✕' : item.level === 'warning' ? '⚠' : 'ℹ' }}
          </span>
          <span class="toast-text">{{ item.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 420px;
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  transition: opacity 0.3s, transform 0.3s;
}

.toast-item.success {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
  border-color: rgba(34, 197, 94, 0.25);
}

.toast-item.error {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.25);
}

.toast-item.warning {
  background: rgba(234, 179, 8, 0.15);
  color: #fde047;
  border-color: rgba(234, 179, 8, 0.25);
}

.toast-item.info {
  background: rgba(96, 165, 250, 0.15);
  color: #93c5fd;
  border-color: rgba(96, 165, 250, 0.25);
}

.toast-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.toast-text {
  flex: 1;
}

.toast-enter-active {
  transition: all 0.3s ease-out;
}

.toast-leave-active {
  transition: all 0.2s ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(60px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.95);
}
</style>