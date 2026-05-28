<script setup lang="ts">
import type { RunSummary } from '@/types'

const props = defineProps<{
  runs: RunSummary[]
}>()

const phases = ['plan', 'execute', 'validate', 'reflect']

function activeIndex(run: RunSummary): number {
  const phase = String(run.phase || '')
  const index = phases.indexOf(phase)
  return index < 0 ? 0 : index
}
</script>

<template>
  <div class="phase-list">
    <article v-for="run in props.runs.slice(0, 4)" :key="run.run_id" class="phase-run">
      <div class="phase-run__head">
        <strong>{{ run.run_id }}</strong>
        <span>{{ run.status }}</span>
      </div>
      <div class="phase-run__steps">
        <span
          v-for="(phase, index) in phases"
          :key="phase"
          class="phase-run__step"
          :class="{ 'phase-run__step--active': index <= activeIndex(run) }"
        >
          {{ phase }}
        </span>
      </div>
    </article>
    <p v-if="!props.runs.length" class="phase-list__empty">No run ledger yet.</p>
  </div>
</template>

<style scoped>
.phase-list {
  display: grid;
  gap: 12px;
}
.phase-run {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: 8px;
  background: rgba(247, 241, 232, 0.04);
}
.phase-run__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-primary);
}
.phase-run__head span {
  color: var(--text-muted);
}
.phase-run__steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.phase-run__step {
  min-height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(247, 241, 232, 0.12);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 0.72rem;
}
.phase-run__step--active {
  color: var(--text-primary);
  border-color: rgba(210, 31, 60, 0.66);
  background: rgba(210, 31, 60, 0.16);
  box-shadow: 0 0 20px rgba(210, 31, 60, 0.24) inset;
}
.phase-list__empty {
  color: var(--text-muted);
}
</style>
