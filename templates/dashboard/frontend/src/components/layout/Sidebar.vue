<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import ActiveRunInstrument from '@/components/v2/ActiveRunInstrument.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { RunSummary, WorkbenchTab } from '@/types'

const store = useDashboardStore()
const router = useRouter()

const zones: Array<{ tab: WorkbenchTab; label: string; route: string; glyph: string; meta: string }> = [
  { tab: 'experiments', label: 'Experiments', route: '/experiments', glyph: 'EX', meta: 'registry, channels, alerts' },
  { tab: 'cockpit', label: 'Cockpit', route: '/cockpit', glyph: 'CK', meta: 'active command deck' },
  { tab: 'runs', label: 'Runs', route: '/runs', glyph: 'RN', meta: 'ledgers, phases, logs' },
  { tab: 'work', label: 'Work', route: '/work', glyph: 'WK', meta: 'authority graph and table' },
  { tab: 'metrics', label: 'Metrics', route: '/metrics', glyph: 'MX', meta: 'loss and metric compare' },
  { tab: 'system', label: 'System', route: '/system', glyph: 'SY', meta: 'runtime telemetry' },
  { tab: 'extensions', label: 'Extensions', route: '/extensions', glyph: 'EX', meta: 'adapters and provider debug' },
]

const navStats = computed(() => ({
  work: store.workItems.length,
  runs: store.progress?.runtime.active_run_count ?? 0,
  experiments: store.experiments?.total ?? 0,
  extensions: store.pluginSummary?.enabled_plugin_count ?? 0,
}))

const runs = computed<RunSummary[]>(() => store.progress?.runtime.active_runs ?? [])

function activate(zone: { tab: WorkbenchTab; route: string }) {
  store.setActiveTab(zone.tab)
  void router.push(zone.route)
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__label">Dashboard/TUI v2</div>
    <nav class="sidebar__zones" aria-label="Dashboard zones">
      <button
        v-for="zone in zones"
        :key="zone.tab"
        class="sidebar__zone"
        :class="{ 'sidebar__zone--active': store.activeTab === zone.tab }"
        @click="activate(zone)"
      >
        <span>{{ zone.glyph }}</span>
        <strong>{{ zone.label }}</strong>
        <small>{{ zone.meta }}</small>
      </button>
    </nav>
    <div class="sidebar__stats">
      <article>
        <span>work</span>
        <strong>{{ navStats.work }}</strong>
      </article>
      <article>
        <span>runs</span>
        <strong>{{ navStats.runs }}</strong>
      </article>
      <article>
        <span>experiments</span>
        <strong>{{ navStats.experiments }}</strong>
      </article>
    </div>
    <ActiveRunInstrument class="sidebar__instrument" :runs="runs" />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 300px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-right: 1px solid var(--border-light);
  background:
    linear-gradient(180deg, rgba(255, 46, 87, 0.08), transparent 32%),
    var(--bg-sidebar);
}

.sidebar__label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.sidebar__zones {
  display: grid;
  gap: 8px;
}

.sidebar__zone {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  grid-template-areas:
    'glyph label'
    'glyph meta';
  gap: 2px 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius);
  background: rgba(247, 241, 232, 0.035);
  text-align: left;
}

.sidebar__zone:hover,
.sidebar__zone--active {
  border-color: rgba(88, 249, 255, 0.4);
  background: linear-gradient(135deg, rgba(88, 249, 255, 0.1), rgba(255, 46, 87, 0.08));
}

.sidebar__zone span {
  grid-area: glyph;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(88, 249, 255, 0.24);
  border-radius: 6px;
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.72rem;
}

.sidebar__zone strong {
  grid-area: label;
  color: var(--text-primary);
}

.sidebar__zone small {
  grid-area: meta;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.sidebar__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.sidebar__stats article {
  padding: 10px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.sidebar__stats span {
  display: block;
  color: var(--text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sidebar__stats strong {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 1.2rem;
}

.sidebar__instrument {
  margin-top: auto;
  grid-template-columns: 1fr;
  min-height: auto;
}

@media (max-width: 960px) {
  .sidebar {
    width: 100%;
    min-width: 0;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid var(--border-light);
  }

  .sidebar__zones {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .sidebar__instrument {
    display: none;
  }
}

@media (max-width: 620px) {
  .sidebar__zones {
    grid-template-columns: 1fr;
  }
}
</style>
