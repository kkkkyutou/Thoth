<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import ActiveRunInstrument from '@/components/v2/ActiveRunInstrument.vue'
import ProfessionalLogViewer from '@/components/v2/ProfessionalLogViewer.vue'
import RunCompare from '@/components/v2/RunCompare.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { RunDetail, RunEvent, RunSummary, RunWorkerLogs } from '@/types'
import { formatTime, isRunActive, shortText, uniqueRuns } from '@/utils/format'

const store = useDashboardStore()
const selectedRunId = ref('')
const selectedRunDetail = ref<RunDetail | null>(null)
const selectedEvents = ref<RunEvent[]>([])
const selectedLogs = ref<RunWorkerLogs | null>(null)
const loading = ref(false)
const error = ref('')

const runs = computed<RunSummary[]>(() => {
  const provider = store.observeSnapshot?.providers.runs as { runs?: RunSummary[] } | undefined
  return uniqueRuns([
    ...(provider?.runs ?? []),
    ...(store.progress?.runtime.active_runs ?? []),
    ...store.workItems.map((item) => item.active_run),
    ...store.workItems.map((item) => item.latest_run),
  ])
})

const activeRuns = computed(() => runs.value.filter((run) => isRunActive(run)))
const selectedRun = computed(
  () => runs.value.find((run) => run.run_id === selectedRunId.value) ?? runs.value[0] ?? null,
)

const logText = computed(() => {
  const logs = selectedLogs.value?.logs ?? {}
  const chunks: string[] = []
  for (const phase of Object.values(logs)) {
    if (phase.stdout.tail) chunks.push(`--- ${phase.phase}.stdout ---\n${phase.stdout.tail}`)
    if (phase.stderr.tail) chunks.push(`--- ${phase.phase}.stderr ---\n${phase.stderr.tail}`)
  }
  if (chunks.length) return chunks.join('\n\n')
  if (selectedEvents.value.length) {
    return selectedEvents.value
      .map((event) => `${event.seq} ${event.ts ?? ''} ${event.level} ${event.kind} ${event.message}`)
      .join('\n')
  }
  return ''
})

async function loadRun(runId: string) {
  if (!runId) return
  loading.value = true
  error.value = ''
  try {
    const [detail, events, logs] = await Promise.all([
      api.getRun(runId),
      api.getRunEvents(runId, null, 120),
      api.getRunWorkerLogs(runId, null, 40000),
    ])
    selectedRunDetail.value = detail
    selectedEvents.value = events.events
    selectedLogs.value = logs
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    loading.value = false
  }
}

watch(
  runs,
  (next) => {
    if (!selectedRunId.value && next[0]) {
      selectedRunId.value = next[0].run_id
    }
  },
  { immediate: true },
)

watch(selectedRunId, (runId) => {
  void loadRun(runId)
})
</script>

<template>
  <section class="runs-panel">
    <div class="runs-panel__hero">
      <ActiveRunInstrument :runs="activeRuns.length ? activeRuns : runs.slice(0, 1)" />
      <article class="v2-card runs-panel__summary">
        <header>
          <span>Runs Workbench</span>
          <strong>{{ runs.length }} ledgers</strong>
        </header>
        <div class="runs-panel__stats">
          <article>
            <span>active</span>
            <strong>{{ activeRuns.length }}</strong>
          </article>
          <article>
            <span>stale</span>
            <strong>{{ runs.filter((run) => run.is_stale || run.stale).length }}</strong>
          </article>
          <article>
            <span>attachable</span>
            <strong>{{ runs.filter((run) => run.attachable).length }}</strong>
          </article>
        </div>
        <p>{{ selectedRun?.latest_message || 'Select a run to inspect phase cards, events and worker output.' }}</p>
      </article>
    </div>

    <div class="runs-panel__grid">
      <article class="v2-card runs-panel__list">
        <header>
          <span>Run Ledger Stack</span>
          <strong>{{ selectedRunId || 'none' }}</strong>
        </header>
        <button
          v-for="run in runs"
          :key="run.run_id"
          class="runs-panel__run"
          :class="{ 'runs-panel__run--selected': selectedRunId === run.run_id }"
          @click="selectedRunId = run.run_id"
        >
          <span>{{ run.status }} · {{ run.phase || 'phase?' }}</span>
          <strong>{{ run.run_id }}</strong>
          <p>{{ shortText(run.latest_message, 'No latest message.', 96) }}</p>
          <small>{{ formatTime(run.last_updated_at ?? run.last_heartbeat_at) }}</small>
        </button>
        <p v-if="!runs.length" class="runs-panel__empty">No run ledgers indexed.</p>
      </article>

      <article class="v2-card runs-panel__detail">
        <RunCompare :runs="runs" />
        <section class="runs-panel__phase-cards">
          <header>
            <span>Phase Cards</span>
            <strong>{{ selectedRunDetail?.phase_cards?.length ?? 0 }}</strong>
          </header>
          <div
            v-for="card in selectedRunDetail?.phase_cards ?? []"
            :key="card.phase"
            class="runs-panel__phase-card"
          >
            <span>{{ card.phase }} · {{ card.status }}</span>
            <strong>{{ card.label }}</strong>
            <p>{{ card.summary || 'No phase summary.' }}</p>
          </div>
          <p v-if="!(selectedRunDetail?.phase_cards?.length)" class="runs-panel__empty">
            {{ loading ? 'Loading phase cards...' : 'No phase cards for this run.' }}
          </p>
        </section>
      </article>
    </div>

    <article class="v2-card">
      <p v-if="error" class="runs-panel__error">{{ error }}</p>
      <ProfessionalLogViewer
        :title="selectedRunId || 'run logs'"
        :text="logText"
        :mode="selectedLogs ? 'stdout' : 'events'"
      />
    </article>
  </section>
</template>

<style scoped>
.runs-panel {
  display: grid;
  gap: 16px;
}

.runs-panel__hero,
.runs-panel__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 16px;
}

.runs-panel__summary,
.runs-panel__list,
.runs-panel__detail {
  padding: 16px;
}

.runs-panel__summary header,
.runs-panel__list header,
.runs-panel__phase-cards header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.runs-panel__summary header span,
.runs-panel__list header span,
.runs-panel__phase-cards header span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.runs-panel__summary header strong,
.runs-panel__list header strong,
.runs-panel__phase-cards header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  overflow-wrap: anywhere;
}

.runs-panel__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.runs-panel__stats article {
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.runs-panel__stats span,
.runs-panel__run span,
.runs-panel__phase-card span {
  display: block;
  color: var(--text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.runs-panel__stats strong {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 1.6rem;
}

.runs-panel__summary p {
  color: var(--text-secondary);
}

.runs-panel__list {
  display: grid;
  align-content: start;
  gap: 8px;
  max-height: 620px;
  overflow-y: auto;
}

.runs-panel__run,
.runs-panel__phase-card {
  display: grid;
  gap: 5px;
  padding: 11px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
  text-align: left;
}

.runs-panel__run:hover,
.runs-panel__run--selected {
  border-color: rgba(88, 249, 255, 0.44);
  background: rgba(88, 249, 255, 0.08);
}

.runs-panel__run strong,
.runs-panel__phase-card strong {
  color: var(--text-primary);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.runs-panel__run p,
.runs-panel__run small,
.runs-panel__phase-card p,
.runs-panel__empty {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.runs-panel__detail {
  display: grid;
  gap: 18px;
}

.runs-panel__phase-cards {
  display: grid;
  gap: 8px;
}

.runs-panel__error {
  margin-bottom: 10px;
  color: var(--accent-primary);
}

@media (max-width: 1080px) {
  .runs-panel__hero,
  .runs-panel__grid {
    grid-template-columns: 1fr;
  }
}
</style>
