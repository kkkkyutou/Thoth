<script setup lang="ts">
import { computed } from 'vue'
import LossCurvePanel from '@/components/visual/LossCurvePanel.vue'
import MetricSparkline from '@/components/visual/MetricSparkline.vue'
import MetricCompare from '@/components/v2/MetricCompare.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { MetricsProviderPayload } from '@/types'

const store = useDashboardStore()

const metrics = computed<MetricsProviderPayload | null>(() => {
  if (store.metricsProvider) return store.metricsProvider
  const provider = store.observeSnapshot?.providers.metrics as MetricsProviderPayload | undefined
  return provider ?? null
})

const numericKeys = computed(() => {
  const keys = new Set<string>()
  for (const record of metrics.value?.metrics ?? []) {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'number' && key !== 'step') keys.add(key)
    }
  }
  return Array.from(keys).slice(0, 6)
})

function valuesFor(key: string): number[] {
  return (metrics.value?.metrics ?? []).map((record) => {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  })
}
</script>

<template>
  <section class="metrics-panel">
    <article class="v2-card metrics-panel__hero">
      <div>
        <span>Metrics Workbench</span>
        <h2>{{ metrics?.run_name || 'Provider metrics' }}</h2>
        <p>{{ metrics?.configured ? 'Live metrics provider is configured.' : metrics?.message || 'Metrics provider is empty.' }}</p>
      </div>
      <div class="metrics-panel__stats">
        <article>
          <span>records</span>
          <strong>{{ metrics?.record_count ?? metrics?.metrics?.length ?? 0 }}</strong>
        </article>
        <article>
          <span>latest step</span>
          <strong>{{ metrics?.latest_step ?? 'N/A' }}</strong>
        </article>
        <article>
          <span>signals</span>
          <strong>{{ numericKeys.length }}</strong>
        </article>
      </div>
    </article>

    <article class="v2-card metrics-panel__compare">
      <MetricCompare :metrics="metrics" />
    </article>

    <div class="metrics-panel__grid">
      <article class="v2-card metrics-panel__loss">
        <header>
          <span>Loss Curves</span>
          <strong>{{ metrics?.source_files?.length ?? 0 }} files</strong>
        </header>
        <LossCurvePanel :metrics="metrics" />
      </article>
      <article class="v2-card metrics-panel__sparks">
        <header>
          <span>Signal Strip</span>
          <strong>{{ numericKeys.length }} metrics</strong>
        </header>
        <MetricSparkline
          v-for="key in numericKeys"
          :key="key"
          :label="key"
          :values="valuesFor(key)"
        />
        <p v-if="!numericKeys.length" class="metrics-panel__empty">No numeric metric fields found.</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.metrics-panel {
  display: grid;
  gap: 16px;
}

.metrics-panel__hero,
.metrics-panel__compare,
.metrics-panel__loss,
.metrics-panel__sparks {
  padding: 16px;
}

.metrics-panel__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  gap: 16px;
  align-items: center;
}

.metrics-panel__hero span,
.metrics-panel__loss header span,
.metrics-panel__sparks header span,
.metrics-panel__stats span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.metrics-panel__hero h2 {
  margin-top: 6px;
  color: var(--text-primary);
  font-size: clamp(1.8rem, 3vw, 3.3rem);
}

.metrics-panel__hero p,
.metrics-panel__empty {
  margin-top: 8px;
  color: var(--text-muted);
}

.metrics-panel__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.metrics-panel__stats article {
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.metrics-panel__stats strong {
  display: block;
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 1.2rem;
  overflow-wrap: anywhere;
}

.metrics-panel__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 16px;
}

.metrics-panel__loss header,
.metrics-panel__sparks header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.metrics-panel__loss header strong,
.metrics-panel__sparks header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

.metrics-panel__sparks {
  display: grid;
  align-content: start;
  gap: 10px;
}

@media (max-width: 1080px) {
  .metrics-panel__hero,
  .metrics-panel__grid {
    grid-template-columns: 1fr;
  }
}
</style>
