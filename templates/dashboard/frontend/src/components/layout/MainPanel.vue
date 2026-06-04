<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import CockpitPanel from '@/components/panels/CockpitPanel.vue'
import ExperimentsPanel from '@/components/panels/ExperimentsPanel.vue'
import MetricsPanel from '@/components/panels/MetricsPanel.vue'
import PluginsPanel from '@/components/panels/PluginsPanel.vue'
import RunsPanel from '@/components/panels/RunsPanel.vue'
import SystemPanel from '@/components/panels/SystemPanel.vue'
import WorkPanel from '@/components/panels/WorkPanel.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { WorkbenchTab } from '@/types'

const router = useRouter()
const store = useDashboardStore()

const tabs = computed<Array<{ key: WorkbenchTab; label: string }>>(() => [
  { key: 'experiments', label: 'Experiments' },
  { key: 'cockpit', label: 'Cockpit' },
  { key: 'runs', label: 'Runs' },
  { key: 'work', label: 'Work' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'system', label: 'System' },
  { key: 'extensions', label: 'Extensions' },
])

const tabRoute: Record<WorkbenchTab, string> = {
  experiments: '/experiments',
  cockpit: '/cockpit',
  runs: '/runs',
  work: '/work',
  metrics: '/metrics',
  system: '/system',
  extensions: '/extensions',
}

function activateTab(tab: WorkbenchTab) {
  store.setActiveTab(tab)
  router.push(tabRoute[tab])
}
</script>

<template>
  <main class="main-panel">
    <div class="main-panel__tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="main-panel__tab"
        :class="{ 'main-panel__tab--active': tab.key === store.activeTab }"
        @click="activateTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="main-panel__content">
      <Transition name="fade" mode="out-in">
        <ExperimentsPanel v-if="store.activeTab === 'experiments'" key="experiments" />
        <CockpitPanel v-else-if="store.activeTab === 'cockpit'" key="cockpit" />
        <RunsPanel v-else-if="store.activeTab === 'runs'" key="runs" />
        <WorkPanel v-else-if="store.activeTab === 'work'" key="work" />
        <MetricsPanel v-else-if="store.activeTab === 'metrics'" key="metrics" />
        <SystemPanel v-else-if="store.activeTab === 'system'" key="system" />
        <PluginsPanel v-else key="extensions" />
      </Transition>
    </div>
  </main>
</template>

<style scoped>
.main-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.main-panel__tabs {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-light);
  background: rgba(8, 6, 7, 0.82);
  overflow-x: auto;
}

.main-panel__tab {
  padding: 8px 14px;
  border-radius: 999px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.main-panel__tab--active {
  background: linear-gradient(135deg, rgba(210, 31, 60, 0.24), rgba(82, 240, 255, 0.08));
  color: var(--text-primary);
  font-weight: 700;
  box-shadow: 0 0 22px rgba(210, 31, 60, 0.16) inset;
}

.main-panel__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

@media (max-width: 720px) {
  .main-panel__tabs {
    padding: 10px;
  }

  .main-panel__tab {
    padding: 7px 10px;
  }

  .main-panel__content {
    padding: 10px;
  }
}
</style>
