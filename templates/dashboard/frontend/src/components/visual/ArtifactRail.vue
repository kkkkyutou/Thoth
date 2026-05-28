<script setup lang="ts">
import type { RunSummary } from '@/types'

const props = defineProps<{
  runs: RunSummary[]
}>()
</script>

<template>
  <div class="artifact-rail">
    <div v-for="run in props.runs.slice(0, 6)" :key="run.run_id" class="artifact-rail__item">
      <strong>{{ run.artifact_count }}</strong>
      <span>{{ run.run_id }}</span>
    </div>
    <p v-if="!props.runs.length">No artifacts yet.</p>
  </div>
</template>

<style scoped>
.artifact-rail {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.artifact-rail__item {
  min-width: 112px;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.12);
  border-radius: 8px;
  background: rgba(247, 241, 232, 0.04);
}
.artifact-rail__item strong {
  display: block;
  color: var(--accent-amber);
  font-size: 1.35rem;
}
.artifact-rail__item span,
.artifact-rail p {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}
</style>
