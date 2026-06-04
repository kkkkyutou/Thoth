<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '@/api/client'
import { useDashboardStore } from '@/stores/dashboard'
import type { ExperimentSummary } from '@/types'

const store = useDashboardStore()
const compareIds = ref<string[]>([])
const comparePayloads = ref<Record<string, Record<string, unknown>>>({})

const experiments = computed(() => store.experiments?.experiments ?? [])
const discovered = computed(() => store.experiments?.discovered ?? [])
const selectedId = computed(() => store.selectedExperiment?.experiment_id ?? store.experiments?.selected_experiment_id ?? '')
const metrics = computed(() => store.metricsProvider)
const alerts = computed(() => {
  const channel = store.selectedExperimentDetail?.channels?.alerts
  const rows = channel?.alerts
  return Array.isArray(rows) ? rows.slice(0, 6) : []
})
const artifacts = computed(() => {
  const channel = store.selectedExperimentDetail?.channels?.artifacts
  const rows = channel?.artifacts
  return Array.isArray(rows) ? rows.slice(0, 6) : []
})
const compareRows = computed(() =>
  compareIds.value.map((id) => {
    const payload = (
      (id === metrics.value?.experiment_id ? metrics.value : comparePayloads.value[id]) ?? {}
    ) as {
      metrics?: Array<Record<string, unknown>>
      latest_step?: number | string | null
      record_count?: number
    }
    const metricRows = Array.isArray(payload.metrics) ? payload.metrics : []
    const keyMetric =
      metricRows.find((item) => String(item.name ?? '').toLowerCase().includes('loss')) ??
      metricRows[0] ??
      {}
    return {
      id,
      metric: String(keyMetric.name ?? '-'),
      current: keyMetric.current ?? keyMetric.ema_current ?? '-',
      step: payload.latest_step ?? '-',
      records: payload.record_count ?? 0,
      status: experiments.value.find((item) => item.experiment_id === id)?.status ?? '-',
    }
  }),
)

function statusClass(status: string) {
  return `experiments-panel__status experiments-panel__status--${status || 'unknown'}`
}

async function toggleCompare(experiment: ExperimentSummary) {
  const id = experiment.experiment_id
  if (compareIds.value.includes(id)) {
    compareIds.value = compareIds.value.filter((item) => item !== id)
    return
  }
  if (compareIds.value.length >= 4) return
  compareIds.value = [...compareIds.value, id]
  if (!comparePayloads.value[id] && id !== metrics.value?.experiment_id) {
    comparePayloads.value = {
      ...comparePayloads.value,
      [id]: await api.getExperimentChannel(id, 'metrics'),
    }
  }
}
</script>

<template>
  <section class="experiments-panel">
    <article class="v2-card experiments-panel__hero">
      <div>
        <span>Experiment Workbench</span>
        <h2>{{ store.selectedExperiment?.title || 'No experiment selected' }}</h2>
        <p>
          {{ store.selectedExperiment?.description || 'Register experiments through thoth extension experiment register, then inspect channels here or in the TUI.' }}
        </p>
      </div>
      <div class="experiments-panel__stats">
        <article>
          <span>registered</span>
          <strong>{{ store.experiments?.total ?? 0 }}</strong>
        </article>
        <article>
          <span>discovered</span>
          <strong>{{ discovered.length }}</strong>
        </article>
        <article>
          <span>records</span>
          <strong>{{ metrics?.record_count ?? 0 }}</strong>
        </article>
        <article>
          <span>alerts</span>
          <strong>{{ alerts.length }}</strong>
        </article>
      </div>
    </article>

    <div class="experiments-panel__grid">
      <article class="v2-card experiments-panel__list">
        <header>
          <span>Registry</span>
          <strong>{{ experiments.length }} visible</strong>
        </header>
        <button
          v-for="experiment in experiments"
          :key="experiment.experiment_id"
          class="experiments-panel__row"
          :class="{ 'experiments-panel__row--active': experiment.experiment_id === selectedId }"
          @click="store.selectExperiment(experiment.experiment_id)"
        >
          <div>
            <strong>{{ experiment.experiment_id }}</strong>
            <span>{{ experiment.title }}</span>
          </div>
          <span :class="statusClass(experiment.status)">{{ experiment.status }}</span>
          <small>{{ experiment.source_count ?? experiment.sources?.length ?? 0 }} sources</small>
        </button>
        <p v-if="!experiments.length" class="experiments-panel__empty">No registered experiments.</p>
      </article>

      <article class="v2-card experiments-panel__channels">
        <header>
          <span>Channels</span>
          <strong>{{ store.selectedExperiment?.source_count ?? 0 }} sources</strong>
        </header>
        <div class="experiments-panel__channel-grid">
          <article v-for="channel in ['metrics', 'logs', 'artifacts', 'events', 'system', 'gpu', 'checkpoints', 'alerts']" :key="channel">
            <span>{{ channel }}</span>
            <strong>{{ store.selectedExperiment?.channels?.[channel]?.length ?? (channel === 'alerts' ? alerts.length : 0) }}</strong>
          </article>
        </div>
        <section class="experiments-panel__metrics">
          <header>
            <span>Selected Metrics</span>
            <strong>{{ metrics?.experiment_id || '-' }}</strong>
          </header>
          <div class="experiments-panel__metric-list">
            <article v-for="metric in metrics?.metrics?.slice(0, 8) ?? []" :key="String(metric.name)">
              <span>{{ metric.name }}</span>
              <strong>{{ metric.current ?? metric.ema_current ?? '-' }}</strong>
            </article>
          </div>
        </section>
      </article>

      <article class="v2-card experiments-panel__ops">
        <header>
          <span>Compare</span>
          <strong>{{ compareIds.length }}/4 selected</strong>
        </header>
        <div class="experiments-panel__compare">
          <button
            v-for="experiment in experiments.slice(0, 8)"
            :key="`compare-${experiment.experiment_id}`"
            :class="{ active: compareIds.includes(experiment.experiment_id) }"
            @click="toggleCompare(experiment)"
          >
            {{ experiment.experiment_id }}
          </button>
        </div>
        <table class="experiments-panel__compare-table" v-if="compareRows.length">
          <thead>
            <tr>
              <th>Experiment</th>
              <th>Status</th>
              <th>Key metric</th>
              <th>Current</th>
              <th>Step</th>
              <th>Records</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in compareRows" :key="row.id">
              <td>{{ row.id }}</td>
              <td>{{ row.status }}</td>
              <td>{{ row.metric }}</td>
              <td>{{ row.current }}</td>
              <td>{{ row.step }}</td>
              <td>{{ row.records }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>Select 2 to 4 experiments for step-aligned metric compare.</p>
      </article>

      <article class="v2-card experiments-panel__evidence">
        <header>
          <span>Evidence Rail</span>
          <strong>{{ artifacts.length }} artifacts</strong>
        </header>
        <div class="experiments-panel__evidence-list">
          <article v-for="artifact in artifacts" :key="String(artifact.path)">
            <span>{{ artifact.preview_type || 'file' }}</span>
            <strong>{{ artifact.title || artifact.path }}</strong>
          </article>
          <p v-if="!artifacts.length" class="experiments-panel__empty">No artifact channel records.</p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.experiments-panel {
  display: grid;
  gap: 16px;
}

.experiments-panel__hero,
.experiments-panel__list,
.experiments-panel__channels,
.experiments-panel__ops,
.experiments-panel__evidence {
  border: 1px solid rgba(247, 241, 232, 0.1);
}

.experiments-panel__hero {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
  gap: 18px;
  align-items: stretch;
}

.experiments-panel__hero span,
.experiments-panel__list header span,
.experiments-panel__channels header span,
.experiments-panel__ops header span,
.experiments-panel__evidence header span,
.experiments-panel__metrics header span {
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.experiments-panel__hero h2 {
  margin: 8px 0;
  color: var(--text-primary);
  font-size: clamp(1.5rem, 2.8vw, 2.4rem);
}

.experiments-panel__hero p,
.experiments-panel__ops p,
.experiments-panel__empty {
  color: var(--text-muted);
  line-height: 1.55;
}

.experiments-panel__stats,
.experiments-panel__channel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.experiments-panel__stats article,
.experiments-panel__channel-grid article,
.experiments-panel__metric-list article,
.experiments-panel__evidence-list article {
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius);
  background: rgba(247, 241, 232, 0.035);
}

.experiments-panel__stats strong,
.experiments-panel__channel-grid strong {
  display: block;
  margin-top: 6px;
  color: var(--accent-cyan);
  font-size: 1.45rem;
}

.experiments-panel__grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.25fr);
  gap: 16px;
}

.experiments-panel__list,
.experiments-panel__channels,
.experiments-panel__ops,
.experiments-panel__evidence {
  display: grid;
  gap: 12px;
}

.experiments-panel__list header,
.experiments-panel__channels header,
.experiments-panel__ops header,
.experiments-panel__evidence header,
.experiments-panel__metrics header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.experiments-panel__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius);
  background: rgba(247, 241, 232, 0.03);
  text-align: left;
}

.experiments-panel__row--active,
.experiments-panel__row:hover {
  border-color: rgba(88, 249, 255, 0.42);
  background: linear-gradient(135deg, rgba(88, 249, 255, 0.08), rgba(210, 31, 60, 0.12));
}

.experiments-panel__row strong,
.experiments-panel__evidence-list strong,
.experiments-panel__metric-list strong {
  color: var(--text-primary);
}

.experiments-panel__row span,
.experiments-panel__row small,
.experiments-panel__metric-list span,
.experiments-panel__evidence-list span {
  color: var(--text-muted);
}

.experiments-panel__status {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 180, 84, 0.12);
  color: var(--accent-amber);
  font-size: 0.76rem;
  font-weight: 700;
}

.experiments-panel__status--running {
  background: rgba(88, 249, 255, 0.12);
  color: var(--accent-cyan);
}

.experiments-panel__status--completed {
  background: rgba(117, 181, 107, 0.14);
  color: #75b56b;
}

.experiments-panel__metrics,
.experiments-panel__metric-list,
.experiments-panel__evidence-list {
  display: grid;
  gap: 8px;
}

.experiments-panel__compare {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.experiments-panel__compare button {
  padding: 7px 10px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: 999px;
  color: var(--text-secondary);
}

.experiments-panel__compare button.active {
  border-color: rgba(88, 249, 255, 0.5);
  color: var(--accent-cyan);
}

.experiments-panel__compare-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.experiments-panel__compare-table th,
.experiments-panel__compare-table td {
  padding: 8px;
  border-bottom: 1px solid rgba(247, 241, 232, 0.08);
  text-align: left;
}

.experiments-panel__compare-table th {
  color: var(--text-muted);
  font-size: 0.68rem;
  text-transform: uppercase;
}

@media (max-width: 980px) {
  .experiments-panel__hero,
  .experiments-panel__grid {
    grid-template-columns: 1fr;
  }
}
</style>
