<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import MainPanel from '@/components/layout/MainPanel.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import CommandPalette from '@/components/v2/CommandPalette.vue'
import EvidenceRail from '@/components/v2/EvidenceRail.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { WorkbenchTab } from '@/types'

const store = useDashboardStore()
const route = useRoute()
const paletteOpen = ref(false)

let timer: number | null = null

async function syncRouteAndLoad() {
  const tab = (route.meta.tab as WorkbenchTab | undefined) ?? 'cockpit'
  store.setActiveTab(tab)
  await store.loadTabData(tab)
}

async function refreshAll() {
  await store.refreshForActiveTab()
}

onMounted(async () => {
  await refreshAll()
  await syncRouteAndLoad()
  window.addEventListener('keydown', handleGlobalKeydown)
  timer = window.setInterval(() => {
    void refreshAll()
  }, 20000)
})

watch(
  () => route.fullPath,
  () => {
    void syncRouteAndLoad()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (timer != null) {
    window.clearInterval(timer)
  }
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
