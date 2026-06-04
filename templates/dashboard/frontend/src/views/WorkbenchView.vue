<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useRoute } from 'vue-router'
import { applyDashboardDelta, type DashboardDeltaPayload } from '@/api/invalidation'
import AppHeader from '@/components/layout/AppHeader.vue'
import MainPanel from '@/components/layout/MainPanel.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import CommandPalette from '@/components/v2/CommandPalette.vue'
import EvidenceRail from '@/components/v2/EvidenceRail.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { WorkbenchTab } from '@/types'

const store = useDashboardStore()
const route = useRoute()
const queryClient = useQueryClient()
const paletteOpen = ref(false)

let eventSource: EventSource | null = null
let reconnectTimer: number | null = null
let reconnectDelayMs = 1000

async function syncRouteAndLoad() {
  const tab = (route.meta.tab as WorkbenchTab | undefined) ?? 'experiments'
  store.setActiveTab(tab)
  await store.loadTabData(tab)
}

async function refreshAll() {
  await store.refreshForActiveTab()
}

function clearReconnectTimer() {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function scheduleSseReconnect() {
  clearReconnectTimer()
  reconnectTimer = window.setTimeout(() => {
    connectSse()
  }, reconnectDelayMs)
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000)
}

function handleDelta(payload: DashboardDeltaPayload) {
  store.markSseConnected(payload.cursor)
  applyDashboardDelta(queryClient, payload)
}

function connectSse() {
  eventSource?.close()
  const params = new URLSearchParams()
  if (store.sseCursor) params.set('cursor', store.sseCursor)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  eventSource = new EventSource(`/api/invalidation/stream${suffix}`)
  eventSource.addEventListener('open', () => {
    reconnectDelayMs = 1000
    store.markSseConnected(store.sseCursor)
  })
  eventSource.addEventListener('thoth.invalidate', (event) => {
    try {
      handleDelta(JSON.parse((event as MessageEvent).data) as DashboardDeltaPayload)
    } catch (caught) {
      store.markSseDisconnected(caught instanceof Error ? caught.message : String(caught))
    }
  })
  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
    store.markSseDisconnected('stream disconnected; reconnect pending')
    scheduleSseReconnect()
  }
}

onMounted(async () => {
  await refreshAll()
  await syncRouteAndLoad()
  window.addEventListener('keydown', handleGlobalKeydown)
  connectSse()
})

watch(
  () => route.fullPath,
  () => {
    void syncRouteAndLoad()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  clearReconnectTimer()
  eventSource?.close()
  eventSource = null
})

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = true
  }
}
</script>

<template>
  <div class="workbench">
    <AppHeader @refresh="refreshAll" @open-palette="paletteOpen = true" />
    <div class="workbench__body">
      <Sidebar />
      <MainPanel />
      <EvidenceRail />
    </div>
    <CommandPalette v-model:open="paletteOpen" @refresh="refreshAll" />
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.workbench__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

@media (max-width: 960px) {
  .workbench__body {
    flex-direction: column;
  }

  .workbench__body :deep(.main-panel) {
    order: 2;
  }

  .workbench__body :deep(.sidebar) {
    order: 1;
  }

  .workbench__body :deep(.evidence-rail) {
    order: 3;
  }
}
</style>
