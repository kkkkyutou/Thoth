<script setup lang="ts">
import { computed } from 'vue'
import type { RunSummary } from '@/types'
import { clampPercent, formatTime } from '@/utils/format'

const props = defineProps<{
  runs: RunSummary[]
}>()

const comparedRuns = computed(() => props.runs.slice(0, 3))
</script>

<template>
  <article class="run-compare">
    <header>
      <span>Run Compare</span>
      <strong>{{ comparedRuns.length }} selected</strong>
    </header>
    <div class="run-compare__table">
      <div class="run-compare__row run-compare__row--head">
        <span>run</span>
        <span>status</span>
        <span>phase</span>
        <span>progress</span>
        <span>heartbeat</span>
      </div>
      <div v-for="run in comparedRuns" :key="run.run_id" class="run-compare__row">
        <strong>{{ run.run_id }}</strong>
        <span>{{ run.status }}</span>
        <span>{{ run.phase || 'N/A' }}</span>
        <span>
          <i :style="{ width: `${clampPercent(run.progress_pct)}%` }"></i>
          {{ clampPercent(run.progress_pct).toFixed(0) }}%
        </span>
        <span>{{ formatTime(run.last_heartbeat_at ?? run.last_updated_at) }}</span>
      </div>
      <p v-if="!comparedRuns.length" class="run-compare__empty">No run ledgers available.</p>
    </div>
  </article>
</template>

<style scoped>
.run-compare {
  display: grid;
  gap: 12px;
}

.run-compare header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.run-compare header span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.run-compare header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

.run-compare__table {
  display: grid;
  gap: 6px;
}

.run-compare__row {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) 0.7fr 0.7fr 0.8fr 1fr;
  gap: 10px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.035);
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.run-compare__row--head {
  color: var(--text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.run-compare__row strong {
  color: var(--text-primary);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.run-compare__row i {
  display: inline-block;
  height: 5px;
  max-width: 72px;
  margin-right: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-cyan));
  vertical-align: 1px;
}

.run-compare__empty {
  color: var(--text-muted);
}

@media (max-width: 780px) {
  .run-compare__row {
    grid-template-columns: 1fr;
  }
}
</style>
