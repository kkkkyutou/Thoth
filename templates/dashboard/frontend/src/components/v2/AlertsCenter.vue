<script setup lang="ts">
import { computed } from 'vue'
import {
  PopoverArrow,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import { useDashboardStore } from '@/stores/dashboard'

const store = useDashboardStore()

const alerts = computed(() => {
  const items: Array<{ tone: string; title: string; body: string }> = []
  if (store.lastError) {
    items.push({ tone: 'danger', title: 'Fetch error', body: store.lastError })
  }
  for (const item of store.progress?.blocked_work_items ?? []) {
    items.push({
      tone: 'warn',
      title: `Blocked ${item.id}`,
      body: item.blocked_by.join(', ') || item.title,
    })
  }
  for (const run of store.progress?.runtime.active_runs ?? []) {
    if (run.is_stale || run.stale) {
      items.push({
        tone: 'warn',
        title: `Stale run ${run.run_id}`,
        body: run.latest_message || 'Heartbeat is stale.',
      })
    }
  }
  for (const error of store.pluginSummary?.validation_errors ?? []) {
    items.push({ tone: 'danger', title: 'Plugin manifest', body: error })
  }
  for (const error of store.metricsProvider?.provider_errors ?? []) {
    items.push({ tone: 'warn', title: 'Metrics provider', body: error })
  }
  if (store.metricsProvider && !store.metricsProvider.configured) {
    items.push({
      tone: 'info',
      title: 'Metrics not configured',
      body: store.metricsProvider.message || 'No metrics provider is enabled.',
    })
  }
  return items
})
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button class="alerts-button" :class="{ 'alerts-button--hot': alerts.length }">
        <span class="alerts-button__dot"></span>
        Alerts
        <strong>{{ alerts.length }}</strong>
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="alerts-popover" :side-offset="10" align="end">
        <header>
          <span>Alerts Center</span>
          <strong>{{ alerts.length }} open</strong>
        </header>
        <div class="alerts-popover__list">
          <article v-for="alert in alerts" :key="`${alert.title}-${alert.body}`" :class="`alert alert--${alert.tone}`">
            <strong>{{ alert.title }}</strong>
            <p>{{ alert.body }}</p>
          </article>
          <p v-if="!alerts.length" class="alerts-popover__empty">No active dashboard alerts.</p>
        </div>
        <PopoverArrow class="alerts-popover__arrow" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
.alerts-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid rgba(247, 241, 232, 0.16);
  border-radius: var(--radius);
  background: rgba(247, 241, 232, 0.045);
  color: var(--text-secondary);
}

.alerts-button--hot {
  border-color: rgba(255, 180, 84, 0.5);
  color: var(--text-primary);
  box-shadow: inset 0 0 22px rgba(255, 180, 84, 0.08);
}

.alerts-button__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent-cyan);
  box-shadow: 0 0 14px rgba(88, 249, 255, 0.72);
}

.alerts-button--hot .alerts-button__dot {
  background: var(--accent-amber);
  box-shadow: 0 0 16px rgba(255, 180, 84, 0.82);
}

.alerts-button strong {
  font-family: var(--font-mono);
}

.alerts-popover {
  z-index: 60;
  width: min(420px, calc(100vw - 24px));
  padding: 14px;
  border: 1px solid rgba(247, 241, 232, 0.16);
  border-radius: var(--radius);
  background: rgba(8, 9, 11, 0.98);
  box-shadow: 0 26px 80px rgba(0, 0, 0, 0.58);
}

.alerts-popover header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(247, 241, 232, 0.1);
}

.alerts-popover header span {
  color: var(--text-primary);
  font-weight: 800;
}

.alerts-popover header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.alerts-popover__list {
  display: grid;
  gap: 10px;
  max-height: 420px;
  overflow-y: auto;
  padding-top: 12px;
}

.alert {
  padding: 11px;
  border: 1px solid rgba(247, 241, 232, 0.12);
  border-left-width: 3px;
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.alert--danger {
  border-left-color: var(--accent-primary);
}

.alert--warn {
  border-left-color: var(--accent-amber);
}

.alert--info {
  border-left-color: var(--accent-cyan);
}

.alert strong {
  display: block;
  color: var(--text-primary);
}

.alert p,
.alerts-popover__empty {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.alerts-popover__arrow {
  fill: rgba(8, 9, 11, 0.98);
}
</style>
