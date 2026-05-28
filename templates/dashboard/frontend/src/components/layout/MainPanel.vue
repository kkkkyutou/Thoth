<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import DagChart from '@/components/charts/DagChart.vue'
import GanttChart from '@/components/charts/GanttChart.vue'
import ModuleDetail from '@/components/detail/ModuleDetail.vue'
import WorkItemDetail from '@/components/detail/WorkItemDetail.vue'
import ActivityPanel from '@/components/panels/ActivityPanel.vue'
import CockpitPanel from '@/components/panels/CockpitPanel.vue'
import SystemPanel from '@/components/panels/SystemPanel.vue'
import TodoPanel from '@/components/todo/TodoPanel.vue'
import ToolPluginPanel from '@/components/visual/ToolPluginPanel.vue'
import WorkItemsPanel from '@/views/WorkItemsPanel.vue'
import { locale } from '@/locales'
import { useDashboardStore } from '@/stores/dashboard'
import type { WorkbenchTab } from '@/types'

const router = useRouter()
const store = useDashboardStore()

const tabs = computed<Array<{ key: WorkbenchTab; label: string }>>(() => [
  { key: 'overview', label: locale.tabs.overview },
  { key: 'detail', label: locale.tabs.detail },
  { key: 'dag', label: locale.tabs.dag },
  { key: 'gantt', label: locale.tabs.gantt },
  { key: 'todo', label: locale.tabs.todo },
  { key: 'activity', label: locale.tabs.activity },
  { key: 'system', label: locale.tabs.system },
])

const tabRoute: Record<WorkbenchTab, string> = {
  overview: '/overview',
  detail: '/work-items',
  dag: '/dag',
  gantt: '/timeline',
  todo: '/todo',
  activity: '/activity',
  system: '/system',
}

function activateTab(tab: WorkbenchTab) {
  if (tab === 'detail') {
    store.clearSelection()
  }
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
        <CockpitPanel v-if="store.activeTab === 'overview'" key="overview" />
        <WorkItemDetail
          v-else-if="store.activeTab === 'detail' && store.selectedWorkItem"
          :key="store.selectedWorkItem.id"
        />
        <ModuleDetail
          v-else-if="store.activeTab === 'detail' && store.selectedModule"
          :key="store.selectedModule.id"
        />
        <WorkItemsPanel v-else-if="store.activeTab === 'detail'" key="work-items" />
        <DagChart v-else-if="store.activeTab === 'dag'" key="dag" />
        <GanttChart v-else-if="store.activeTab === 'gantt'" key="gantt" />
        <section v-else-if="store.activeTab === 'todo'" key="todo" class="tools-panel">
          <article class="tools-panel__section">
            <div class="tools-panel__header">
              <span>Tool Plugins</span>
              <strong>{{ store.toolPlugins.length }}</strong>
            </div>
            <ToolPluginPanel :tools="store.toolPlugins" />
          </article>
          <article class="tools-panel__section">
            <div class="tools-panel__header">
              <span>Local Todo DB</span>
              <strong>write</strong>
            </div>
            <TodoPanel />
          </article>
        </section>
        <ActivityPanel v-else-if="store.activeTab === 'activity'" key="activity" />
        <SystemPanel v-else key="system" />
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

.main-panel__placeholder {
  display: grid;
  place-items: center;
  min-height: 240px;
  color: var(--text-muted);
}

.tools-panel {
  display: grid;
  gap: 16px;
}

.tools-panel__section {
  padding: 16px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: rgba(19, 9, 11, 0.84);
  box-shadow: var(--shadow-soft);
}

.tools-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  color: var(--text-muted);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tools-panel__header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  letter-spacing: 0;
  text-transform: none;
}
</style>
