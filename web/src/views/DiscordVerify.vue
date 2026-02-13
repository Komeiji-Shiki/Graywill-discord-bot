<script setup lang="ts">
import { computed, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface VerifyResponse {
  ok: boolean
  message: string
  data?: {
    botUser?: string
    guildCount?: number
    intents?: string[]
    permissions?: string[]
  }
}

const { post, loading, error } = useApi()

const botToken = ref('')
const clientId = ref('')
const guildId = ref('')
const selectedIntents = ref<string[]>([
  'Guilds',
  'GuildMessages',
  'MessageContent',
])

const intentOptions = [
  'Guilds',
  'GuildMembers',
  'GuildMessages',
  'GuildMessageReactions',
  'DirectMessages',
  'MessageContent',
]

const permissionOptions = [
  { name: 'View Channels', value: 1024n },
  { name: 'Send Messages', value: 2048n },
  { name: 'Embed Links', value: 16384n },
  { name: 'Attach Files', value: 32768n },
  { name: 'Read Message History', value: 65536n },
  { name: 'Use Slash Commands', value: 2147483648n },
  { name: 'Manage Messages', value: 8192n },
]

const selectedPermissions = ref<string[]>([
  'View Channels',
  'Send Messages',
  'Read Message History',
  'Use Slash Commands',
])

const verifyResult = ref<VerifyResponse | null>(null)

function toggleInArray(arr: string[], value: string) {
  const idx = arr.indexOf(value)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(value)
}

const permissionsInteger = computed(() => {
  const sum = permissionOptions
    .filter((p) => selectedPermissions.value.includes(p.name))
    .reduce((acc, p) => acc + p.value, 0n)
  return sum.toString()
})

const oauthUrl = computed(() => {
  if (!clientId.value.trim()) return ''
  const params = new URLSearchParams({
    client_id: clientId.value.trim(),
    scope: 'bot applications.commands',
    permissions: permissionsInteger.value,
  })
  if (guildId.value.trim()) params.set('guild_id', guildId.value.trim())
  params.set('disable_guild_select', guildId.value.trim() ? 'true' : 'false')
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`
})

async function runVerify() {
  verifyResult.value = null
  try {
    const data = await post<VerifyResponse>('/discord/verify', {
      token: botToken.value.trim(),
      intents: selectedIntents.value,
      permissions: selectedPermissions.value,
      clientId: clientId.value.trim(),
    })
    verifyResult.value = data
  } catch {
    verifyResult.value = {
      ok: false,
      message: error.value?.message ?? '验证失败',
    }
  }
}

async function runPingGateway() {
  verifyResult.value = null
  try {
    const data = await post<VerifyResponse>('/discord/ping', {
      token: botToken.value.trim(),
      intents: selectedIntents.value,
    })
    verifyResult.value = data
  } catch {
    verifyResult.value = {
      ok: false,
      message: error.value?.message ?? '网关连接失败',
    }
  }
}
</script>

<template>
  <section class="stack">
    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">Discord 验证面板</div>
          <div class="panel-subtitle">Token / Intents / OAuth 邀请链接 / API 连通性检查</div>
        </div>
        <span class="badge warning">VERIFY</span>
      </div>

      <div class="panel-body stack">
        <div class="grid-2">
          <label class="stack">
            <span class="muted">Bot Token</span>
            <input
              class="stellar-input"
              type="password"
              v-model="botToken"
              placeholder="输入 Discord Bot Token（仅用于后端验证）"
            />
          </label>

          <label class="stack">
            <span class="muted">Application Client ID</span>
            <input
              class="stellar-input"
              v-model="clientId"
              placeholder="Discord Application Client ID"
            />
          </label>

          <label class="stack">
            <span class="muted">指定 Guild ID（可选）</span>
            <input
              class="stellar-input"
              v-model="guildId"
              placeholder="留空则安装时可选服务器"
            />
          </label>

          <div class="stack">
            <span class="muted">推荐权限组合</span>
            <div class="split" style="flex-wrap: wrap; gap: 6px;">
              <label class="badge" v-for="p in permissionOptions" :key="p.name">
                <input
                  type="checkbox"
                  :checked="selectedPermissions.includes(p.name)"
                  @change="toggleInArray(selectedPermissions, p.name)"
                />
                {{ p.name }}
              </label>
            </div>
            <span class="kbd">permissions={{ permissionsInteger }}</span>
          </div>
        </div>

        <div class="stack">
          <span class="muted">Gateway Intents</span>
          <div class="split" style="flex-wrap: wrap; gap: 6px;">
            <label class="badge" v-for="intent in intentOptions" :key="intent">
              <input
                type="checkbox"
                :checked="selectedIntents.includes(intent)"
                @change="toggleInArray(selectedIntents, intent)"
              />
              {{ intent }}
            </label>
          </div>
        </div>

        <label class="stack">
          <span class="muted">OAuth 邀请链接</span>
          <textarea
            class="stellar-textarea"
            :value="oauthUrl || '请输入 Client ID 生成邀请链接'"
            readonly
            rows="3"
          />
        </label>

        <div class="split">
          <button class="stellar-button ghost" :disabled="loading" @click="runPingGateway">
            {{ loading ? '检测中...' : '检测网关连通性' }}
          </button>
          <button class="stellar-button" :disabled="loading" @click="runVerify">
            {{ loading ? '验证中...' : '执行完整验证' }}
          </button>
        </div>
      </div>
    </div>

    <div class="stellar-panel">
      <div class="panel-header">
        <div>
          <div class="panel-title">验证结果</div>
          <div class="panel-subtitle">后端返回 Discord 鉴权与权限检查结果</div>
        </div>
        <span class="badge" :class="verifyResult?.ok ? 'success' : 'danger'">
          {{ verifyResult ? (verifyResult.ok ? 'PASS' : 'FAIL') : 'WAIT' }}
        </span>
      </div>
      <div class="panel-body stack">
        <div class="muted" v-if="!verifyResult">尚未执行验证</div>
        <template v-else>
          <div>{{ verifyResult.message }}</div>
          <textarea
            class="stellar-textarea"
            :value="JSON.stringify(verifyResult, null, 2)"
            readonly
            rows="8"
          />
        </template>
      </div>
    </div>
  </section>
</template>