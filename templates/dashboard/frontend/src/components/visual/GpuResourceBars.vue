<script setup lang="ts">
const props = defineProps<{
  rows: Array<Record<string, unknown>>
}>()

function pct(value: unknown): number {
  return Math.max(0, Math.min(100, Number(value || 0)))
}
</script>

<template>
  <div class="gpu-bars">
    <div v-for="row in props.rows" :key="String(row.index ?? row.name)" class="gpu-bars__row">
      <span>{{ row.name || `GPU ${row.index}` }}</span>
      <div><i :style="{ width: `${pct(row.utilization_pct)}%` }" /></div>
      <strong>{{ pct(row.utilization_pct) }}%</strong>
    </div>
    <p v-if="!props.rows.length" class="gpu-bars__empty">GPU data unavailable.</p>
  </div>
</template>

<style scoped>
.gpu-bars {
  display: grid;
  gap: 10px;
}
.gpu-bars__row {
  display: grid;
  grid-template-columns: minmax(72px, 0.9fr) minmax(54px, 1.35fr) minmax(34px, max-content);
  align-items: center;
  gap: 8px;
}
.gpu-bars__row span,
.gpu-bars__empty {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gpu-bars__row div {
  height: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(247, 241, 232, 0.08);
}
.gpu-bars__row i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-cyan));
  box-shadow: 0 0 18px rgba(82, 240, 255, 0.45);
}
.gpu-bars__row strong {
  color: var(--text-primary);
  font-size: 0.8rem;
  text-align: right;
}
</style>
