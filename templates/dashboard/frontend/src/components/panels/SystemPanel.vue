<script setup lang="ts">
import { computed, onMounted } from 'vue'
import GpuResourceBars from '@/components/visual/GpuResourceBars.vue'
import HealthMatrix from '@/components/visual/HealthMatrix.vue'
import ProfessionalLogViewer from '@/components/v2/ProfessionalLogViewer.vue'
import { useDashboardStore } from '@/stores/dashboard'
import { asRecord, formatTime } from '@/utils/format'

const store = useDashboardStore()

const system = computed(() => asRecord(store.systemStatus))
const runtime = computed(() => asRecord(system.value.runtime ?? store.overviewSummary?.runtime))
const compiler = computed(() => asRecord(system.value.compiler ?? store.overviewSummary?.compiler_summary))
const cacheInfo = computed(() => asRecord(system.value.cache_info))
const systemProvider = computed(() => asRecord(store.observeSnapshot?.providers.system))
const gpuRows = computed(() => {
  const gpu = asRecord(systemProvider.value.gpu)
  const rows = gpu.gpus
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : []
})
const snapshotText = computed(() =>
  JSON.stringify(
    {
      system: system.value,
      runtime: runtime.value,
      compiler: compiler.value,
      provider: systemProvider.value,
    },
    null,
    2,
  ),
)

onMounted(() => {
  void store.fetchSystemStatus()
})
</script>

<template>
  <section class="system-panel">
    <article class="v2-card system-panel__hero">
      <div>
        <span>System Workbench</span>
        <h2>{{ store.overviewSummary?.healthy ? 'Runtime nominal' : 'Runtime needs attention' }}</h2>
        <p>{{ store.overviewSummary?.health_message || 'System read model is available.' }}</p>
      </div>
      <div class="system-panel__stats">
        <article>
          <span>work items</span>
          <strong>{{ system.work_item_count ?? 0 }}</strong>
        </article>
        <article>
          <span>modules</span>
          <strong>{{ system.module_count ?? 0 }}</strong>
        </article>
        <article>
          <span>updated</span>
          <strong>{{ formatTime(system.last_updated as string | number | undefined) }}</strong>
        </article>
      </div>
    </article>

    <div class="system-panel__grid">
      <article class="v2-card system-panel__health">
        <header>
          <span>Health Matrix</span>
          <strong>{{ store.overviewSummary?.healthy ? 'ok' : 'check' }}</strong>
        </header>
        <HealthMatrix
          :healthy="store.overviewSummary?.healthy ?? false"
          :message="store.overviewSummary?.health_message ?? 'No health payload yet.'"
          :compiler="store.overviewSummary?.compiler_summary"
        />
      </article>
      <article class="v2-card system-panel__gpu">
        <header>
          <span>GPU / System Provider</span>
          <strong>{{ gpuRows.length ? 'configured' : 'empty' }}</strong>
        </header>
        <GpuResourceBars :rows="gpuRows" />
      </article>
      <article class="v2-card system-panel__json">
        <ProfessionalLogViewer title="system snapshot" :text="snapshotText" mode="json" />
      </article>
    </div>

    <div class="system-panel__cards">
      <article class="v2-card">
        <h3>Runtime</h3>
        <pre>{{ JSON.stringify(runtime, null, 2) }}</pre>
      </article>
      <article class="v2-card">
        <h3>Compiler</h3>
        <pre>{{ JSON.stringify(compiler, null, 2) }}</pre>
      </article>
      <article class="v2-card">
        <h3>Cache</h3>
        <pre>{{ JSON.stringify(cacheInfo, null, 2) }}</pre>
      </article>
    </div>
  </section>
</template>

<style scoped>
.system-panel {
  display: grid;
  gap: 16px;
}

.system-panel__hero,
.system-panel__health,
.system-panel__gpu,
.system-panel__json,
.system-panel__cards > article {
  padding: 16px;
}

.system-panel__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.9fr);
  gap: 16px;
  align-items: center;
}

.system-panel__hero span,
.system-panel__stats span,
.system-panel__health header span,
.system-panel__gpu header span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.system-panel__hero h2 {
  margin-top: 6px;
  color: var(--text-primary);
  font-size: clamp(1.8rem, 3vw, 3.2rem);
}

.system-panel__hero p {
  margin-top: 8px;
  color: var(--text-muted);
}

.system-panel__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.system-panel__stats article {
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.system-panel__stats strong {
  display: block;
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.system-panel__grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(360px, 1.4fr);
  gap: 16px;
}

.system-panel__health header,
.system-panel__gpu header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.system-panel__health header strong,
.system-panel__gpu header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

.system-panel__cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.system-panel__cards h3 {
  color: var(--text-primary);
}

pre {
  max-height: 320px;
  margin-top: 12px;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

@media (max-width: 1180px) {
  .system-panel__hero,
  .system-panel__grid,
  .system-panel__cards {
    grid-template-columns: 1fr;
  }
}
</style>
