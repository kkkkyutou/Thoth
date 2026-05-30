<script setup lang="ts">
import { computed } from 'vue'
import ArtifactPreview from '@/components/v2/ArtifactPreview.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { RunSummary } from '@/types'
import { formatTime, uniqueRuns } from '@/utils/format'

const store = useDashboardStore()

const runs = computed<RunSummary[]>(() => {
  const provider = store.observeSnapshot?.providers.runs as { runs?: RunSummary[] } | undefined
  return uniqueRuns([
    ...(provider?.runs ?? []),
    ...(store.progress?.runtime.active_runs ?? []),
    ...store.workItems.map((item) => item.active_run),
    ...store.workItems.map((item) => item.latest_run),
  ])
})

const evidencePaths = computed(() => {
  const selectedPaths = store.selectedWorkItem?.work_result?.evidence_paths ?? []
  const conclusionPaths =
    store.overviewSummary?.recent_conclusions.flatMap((item) => item.evidence_paths ?? []) ?? []
  return Array.from(new Set([...selectedPaths, ...conclusionPaths])).slice(0, 8)
})
</script>

<template>
  <aside class="evidence-rail" aria-label="Evidence Rail">
    <header>
      <span>Evidence Rail</span>
      <strong>{{ evidencePaths.length }} artifacts</strong>
    </header>

    <section class="evidence-rail__section">
      <h3>Live Ledgers</h3>
      <button v-for="run in runs.slice(0, 6)" :key="run.run_id" class="evidence-run">
        <span>{{ run.status }} · {{ run.phase || 'phase?' }}</span>
        <strong>{{ run.run_id }}</strong>
        <p>{{ formatTime(run.last_updated_at ?? run.last_heartbeat_at) }}</p>
      </button>
      <p v-if="!runs.length" class="evidence-rail__empty">No run ledgers indexed.</p>
    </section>

    <section class="evidence-rail__section">
      <h3>Artifact Preview</h3>
      <ArtifactPreview v-for="path in evidencePaths" :key="path" :path="path" />
      <p v-if="!evidencePaths.length" class="evidence-rail__empty">
        Select a work item or wait for conclusions to populate artifacts.
      </p>
    </section>
  </aside>
</template>

<style scoped>
.evidence-rail {
  width: 310px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-left: 1px solid var(--border-light);
  background:
    linear-gradient(180deg, rgba(88, 249, 255, 0.05), transparent 34%),
    rgba(8, 9, 11, 0.88);
  overflow-y: auto;
}

.evidence-rail header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.evidence-rail header span,
.evidence-rail__section h3 {
  color: var(--text-primary);
  font-size: 0.78rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.evidence-rail header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

.evidence-rail__section {
  display: grid;
  gap: 9px;
}

.evidence-run {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
  text-align: left;
}

.evidence-run:hover {
  border-color: rgba(88, 249, 255, 0.36);
}

.evidence-run span {
  color: var(--accent-amber);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.evidence-run strong {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.evidence-run p,
.evidence-rail__empty {
  color: var(--text-muted);
  font-size: 0.78rem;
}

@media (max-width: 1180px) {
  .evidence-rail {
    width: 100%;
    min-width: 0;
    max-height: none;
    border-left: none;
    border-top: 1px solid var(--border-light);
  }
}
</style>
