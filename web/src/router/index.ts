import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: {
      title: '仪表盘',
      subtitle: 'Bot状态、吞吐、Token与运行态总览',
    },
  },
  {
    path: '/channels',
    name: 'channels',
    component: () => import('@/views/Channels.vue'),
    meta: {
      title: '频道管理',
      subtitle: '频道绑定模型/预设/角色卡与触发策略',
    },
  },
  {
    path: '/presets',
    name: 'presets',
    component: () => import('@/views/Presets.vue'),
    meta: {
      title: '预设管理',
      subtitle: '导入酒馆预设、编辑主提示词/系统提示词/世界书/预填充',
    },
  },
  {
    path: '/characters',
    name: 'characters',
    component: () => import('@/views/Characters.vue'),
    meta: {
      title: '角色卡',
      subtitle: '角色信息、开场白、角色世界书与宏变量',
    },
  },
  {
    path: '/worldbooks',
    redirect: '/presets',
  },
  {
    path: '/regex',
    name: 'regex',
    component: () => import('@/views/RegexScripts.vue'),
    meta: {
      title: '正则脚本',
      subtitle: 'Affects/View/Depth维度处理链调优',
    },
  },
  {
    path: '/models',
    name: 'models',
    component: () => import('@/views/Models.vue'),
    meta: {
      title: '模型端点',
      subtitle: 'OpenAI兼容URL、API Key、参数模板管理',
    },
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('@/views/History.vue'),
    meta: {
      title: '聊天历史',
      subtitle: '合并式时间线日志、压缩状态与导出',
    },
  },
  {
    path: '/summaries',
    name: 'summaries',
    component: () => import('@/views/Summaries.vue'),
    meta: {
      title: '总结管理',
      subtitle: '对话总结列表、提示词配置、模型参数管理',
    },
  },
  {
    path: '/discord-verify',
    name: 'discord-verify',
    component: () => import('@/views/DiscordVerify.vue'),
    meta: {
      title: 'Discord 验证',
      subtitle: 'Token / Intents / 权限 / OAuth 邀请链接 / 连通性检查',
    },
  },
  {
    path: '/variables',
    name: 'variables',
    component: () => import('@/views/Variables.vue'),
    meta: {
      title: '变量中心',
      subtitle: '全局变量、频道变量、宏替换验证',
    },
  },
  {
    path: '/macros',
    name: 'macros',
    component: () => import('@/views/Macros.vue'),
    meta: {
      title: '宏变量总览',
      subtitle: '查看所有可用宏及其当前值，支持搜索与来源过滤',
    },
  },
  {
    path: '/debug',
    name: 'debug',
    component: () => import('@/views/Debug.vue'),
    meta: {
      title: '调试 & Prompt 预览',
      subtitle: '实时构建Prompt、各阶段预览、发送给LLM的完整消息查看',
    },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0, left: 0 }
  },
})

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? 'GrayWill'
  document.title = `${title} · GrayWill`
})

export default router