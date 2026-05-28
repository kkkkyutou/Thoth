<script setup lang="ts">
import type { GanttRow } from '@/types'

const props = defineProps<{
  rows: GanttRow[]
}>()
</script>

<template>
  <div class="gantt-lane">
    <div v-for="row in props.rows.slice(0, 8)" :key="row.id" class="gantt-lane__row">
      <span>{{ row.title }}</span>
      <div><i :style="{ width: `${Math.max(4, Math.min(100, row.progress || 0))}%` }" /></div>
      <strong>{{ Math.round(row.progress || 0) }}%</strong>
    </div>
    <p v-if="!props.rows.length" class="gantt-lane__empty">No timeline rows.</p>
  </div>
</template>

<style scoped>
.gantt-lane {
  display: grid;
  gap: 9px;
}
.gantt-lane__row {
  display: grid;
  grid-template-columns: minmax(120px, 1.2fr) minmax(120px, 2fr) 44px;
  gap: 10px;
  align-items: center;
}
.gantt-lane__row span {
  color: var(--text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.gantt-lane__row div {
  height: 10px;
  border-radius: 999px;
  background: rgba(247, 241, 232, 0.08);
  overflow: hidden;
}
.gantt-lane__row i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-amber));
  box-shadow: 0 0 14px rgba(210, 31, 60, 0.38);
}
.gantt-lane__row strong,
.gantt-lane__empty {
  color: var(--text-primary);
  font-size: 0.8rem;
}
</style>
