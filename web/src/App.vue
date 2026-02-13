<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import ToastContainer from './components/ToastContainer.vue'

const route = useRoute()

const pageTitle = computed(() => (route.meta.title as string | undefined) ?? '控制台')
const pageSubtitle = computed(
  () => (route.meta.subtitle as string | undefined) ?? 'GrayWill · Discord Bot 管理面板'
)

const navItems = [
  { label: '仪表盘', to: '/' },
  { label: '频道管理', to: '/channels' },
  { label: 'Discord 验证', to: '/discord-verify' },
  { label: '预设管理', to: '/presets' },
  { label: '角色卡', to: '/characters' },
  { label: '正则脚本', to: '/regex' },
  { label: '模型端点', to: '/models' },
  { label: '聊天历史', to: '/history' },
  { label: '总结管理', to: '/summaries' },
  { label: '变量中心', to: '/variables' },
  { label: '宏变量总览', to: '/macros' },
  { label: '调试 / Prompt 预览', to: '/debug' },
]
</script>

<template>
  <div class="app-shell">
    <aside class="side-nav">
      <div class="brand stellar-panel">
        <div class="panel-body">
          <div class="brand-title">GrayWill Console</div>
          <div class="brand-subtitle">Deep Space Control Surface</div>
        </div>
      </div>

      <nav class="nav-group">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          class="nav-item"
          :to="item.to"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <main class="main-content">
      <header class="page-header">
        <div>
          <div class="page-title">{{ pageTitle }}</div>
          <div class="page-subtitle">{{ pageSubtitle }}</div>
        </div>
        <div class="badge success">ONLINE · PANEL</div>
      </header>

      <RouterView />
    </main>

    <ToastContainer />
  </div>
</template>