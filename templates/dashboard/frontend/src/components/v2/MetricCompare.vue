<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import type { MetricsProviderPayload } from '@/types'

const props = defineProps<{
  metrics: MetricsProviderPayload | null
}>()

const chartEl = ref<HTMLElement | null>(null)
const selectedA = ref('')
const selectedB = ref('')
let plot: uPlot | null = null

const records = computed(() => props.metrics?.metrics ?? [])
const numericKeys = computed(() => {
  const keys = new Set<string>()
  for (const record of records.value) {
    for (const [key, value] of Object.entries(record)) {
      if (key === 'step') continue
      if (typeof value === 'number' && Number.isFinite(value)) keys.add(key)
    }
  }
  return Array.from(keys).slice(0, 12)
})

const xValues = computed(() =>
  records.value.map((record, index) => {
    const step = record.step
    return typeof step === 'number' && Number.isFinite(step) ? step : index + 1
  }),
)

function yValues(key: string): number[] {
  return records.value.map((record) => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN
  })
}

function ensureSelection() {
  if (!selectedA.value && numericKeys.value[0]) selectedA.value = numericKeys.value[0]
  if (!selectedB.value && numericKeys.value[1]) selectedB.value = numericKeys.value[1]
}

function renderPlot() {
  ensureSelection()
  if (!chartEl.value || !xValues.value.length || !selectedA.value) return
  plot?.destroy()
  const width = Math.max(320, chartEl.value.clientWidth || 720)
  const data: uPlot.AlignedData = [
    xValues.value,
    yValues(selectedA.value),
    selectedB.value ? yValues(selectedB.value) : xValues.value.map(() => NaN),
  ]
  plot = new uPlot(
    {
      width,
      height: 280,
      class: 'thoth-uplot',
      scales: { x: { time: false } },
      series: [
        {},
        { label: selectedA.value, stroke: '#58f9ff', width: 2 },
        { label: selectedB.value || 'none', stroke: '#ffb454', width: 2 },
      ],
      axes: [
        { stroke: '#a99f99', grid: { stroke: 'rgba(247,241,232,.08)' } },
        { stroke: '#a99f99', grid: { stroke: 'rgba(247,241,232,.08)' } },
      ],
    },
    data,
    chartEl.value,
  )
}

watch([records, numericKeys, selectedA, selectedB], () => {
  void nextTick(renderPlot)
})

onMounted(() => {
  void nextTick(renderPlot)
  window.addEventListener('resize', renderPlot)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', renderPlot)
  plot?.destroy()
})
</script>

<template>
  <article class="metric-compare">
    <header>
      <div>
        <span>Run / Metric Compare</span>
        <strong>{{ metrics?.record_count ?? records.length }} records</strong>
      </div>
      <div class="metric-compare__selectors">
        <select v-model="selectedA">
          <option v-for="key in numericKeys" :key="key" :value="key">{{ key }}</option>
        </select>
        <select v-model="selectedB">
          <option value="">none</option>
          <option v-for="key in numericKeys" :key="key" :value="key">{{ key }}</option>
        </select>
      </div>
    </header>
    <div v-if="records.length && numericKeys.length" ref="chartEl" class="metric-compare__chart"></div>
    <p v-else class="metric-compare__empty">
      {{ metrics?.message || 'Metrics provider has no numeric records yet.' }}
    </p>
  </article>
</template>

<style scoped>
.metric-compare {
  display: grid;
  gap: 12px;
}

.metric-compare header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.metric-compare header span {
  display: block;
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.metric-compare header strong {
  color: var(--text-primary);
}

.metric-compare__selectors {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.metric-compare__selectors select {
  max-width: 220px;
}

.metric-compare__chart {
  min-height: 280px;
  overflow: hidden;
}

.metric-compare__empty {
  min-height: 180px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  text-align: center;
}

:deep(.uplot) {
  color: var(--text-secondary);
  background: transparent;
}

:deep(.u-legend) {
  color: var(--text-secondary);
  background: rgba(8, 9, 11, 0.92);
}

@media (max-width: 680px) {
  .metric-compare header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
