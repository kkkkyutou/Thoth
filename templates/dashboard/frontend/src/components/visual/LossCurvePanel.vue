<script setup lang="ts">
import MetricSparkline from '@/components/visual/MetricSparkline.vue'
import type { MetricsProviderPayload } from '@/types'

const props = defineProps<{
  metrics: MetricsProviderPayload | null
}>()

function metricRows(): Array<Record<string, unknown>> {
  return props.metrics?.metrics ?? []
}

function values(row: Record<string, unknown>): number[] {
  const history = row.history as { raw?: number[] } | undefined
  return Array.isArray(history?.raw) ? history.raw : []
}
</script>

<template>
  <div class="loss-panel">
    <div v-if="!props.metrics?.configured" class="loss-panel__empty">
      {{ props.metrics?.message || 'No metrics provider configured.' }}
    </div>
    <div v-else class="loss-panel__grid">
      <MetricSparkline
        v-for="row in metricRows().slice(0, 4)"
        :key="String(row.name)"
        :label="String(row.name)"
        :values="values(row)"
      />
    </div>
  </div>
</template>

<style scoped>
.loss-panel__empty {
  padding: 18px;
  border: 1px dashed rgba(255, 180, 84, 0.45);
  border-radius: 8px;
  color: var(--accent-amber);
  background: rgba(255, 180, 84, 0.08);
}
.loss-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
</style>
