<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { useDashboardStore } from '@/stores/dashboard'
import type { WorkbenchTab } from '@/types'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  refresh: []
}>()

const router = useRouter()
const store = useDashboardStore()
const query = ref('')

const zones: Array<{ tab: WorkbenchTab; label: string; route: string; hint: string }> = [
  { tab: 'cockpit', label: 'Cockpit', route: '/cockpit', hint: 'Authority, alerts, active run' },
  { tab: 'runs', label: 'Runs', route: '/runs', hint: 'Run compare and logs' },
  { tab: 'work', label: 'Work', route: '/work', hint: 'Work items and DAG' },
  { tab: 'metrics', label: 'Metrics', route: '/metrics', hint: 'Metric compare and curves' },
  { tab: 'system', label: 'System', route: '/system', hint: 'Runtime and provider health' },
  { tab: 'plugins', label: 'Plugins', route: '/plugins', hint: 'Tools and plugin debug' },
]

const actions = computed(() => {
  const workActions = store.workItems.slice(0, 12).map((item) => ({
    id: `work:${item.id}`,
    label: item.id,
    hint: item.title,
    group: 'Work',
    run: () => {
      void store.selectWorkItem(item.id)
      void router.push('/work')
    },
  }))
  const zoneActions = zones.map((zone) => ({
    id: `zone:${zone.tab}`,
    label: zone.label,
    hint: zone.hint,
    group: 'Zones',
    run: () => {
      store.setActiveTab(zone.tab)
      void router.push(zone.route)
    },
  }))
  const utilityActions = [
    {
      id: 'refresh',
      label: 'Refresh all providers',
      hint: 'Re-fetch dashboard read model',
      group: 'Utilities',
      run: () => emit('refresh'),
    },
  ]
  return [...zoneActions, ...workActions, ...utilityActions]
})

const filteredActions = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return actions.value
  return actions.value.filter((action) =>
    `${action.label} ${action.hint} ${action.group}`.toLowerCase().includes(needle),
  )
})

function runAction(action: { run: () => void }) {
  action.run()
  emit('update:open', false)
}

watch(
  () => props.open,
  (value) => {
    if (value) query.value = ''
  },
)
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="palette__overlay" />
      <DialogContent class="palette">
        <DialogTitle class="palette__title">Command Palette</DialogTitle>
        <DialogDescription class="palette__description">
          Jump across the six-zone dashboard or focus a work item.
        </DialogDescription>
        <input
          v-model="query"
          class="palette__input"
          autofocus
          placeholder="Search zones, runs, work ids..."
          @keydown.enter.prevent="filteredActions[0] && runAction(filteredActions[0])"
        />
        <div class="palette__list">
          <button
            v-for="action in filteredActions"
            :key="action.id"
            class="palette__action"
            @click="runAction(action)"
          >
            <span>{{ action.group }}</span>
            <strong>{{ action.label }}</strong>
            <p>{{ action.hint }}</p>
          </button>
          <p v-if="!filteredActions.length" class="palette__empty">No matching command.</p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.palette__overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(8px);
}

.palette {
  position: fixed;
  left: 50%;
  top: 11vh;
  z-index: 71;
  width: min(720px, calc(100vw - 28px));
  max-height: min(760px, calc(100vh - 64px));
  transform: translateX(-50%);
  padding: 16px;
  border: 1px solid rgba(88, 249, 255, 0.28);
  border-radius: var(--radius);
  background:
    linear-gradient(135deg, rgba(255, 46, 87, 0.16), transparent 42%),
    rgba(8, 9, 11, 0.98);
  box-shadow: 0 32px 110px rgba(0, 0, 0, 0.68), 0 0 44px rgba(88, 249, 255, 0.12);
}

.palette__title {
  color: var(--text-primary);
  font-size: 1.05rem;
}

.palette__description {
  margin-top: 4px;
  color: var(--text-muted);
}

.palette__input {
  width: 100%;
  margin-top: 14px;
  padding: 14px 16px;
  border-color: rgba(88, 249, 255, 0.3);
  background: rgba(247, 241, 232, 0.055);
  font-family: var(--font-mono);
}

.palette__list {
  display: grid;
  gap: 8px;
  max-height: 520px;
  margin-top: 12px;
  overflow-y: auto;
}

.palette__action {
  display: grid;
  grid-template-columns: 86px minmax(0, 0.7fr) minmax(0, 1.3fr);
  gap: 10px;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
  text-align: left;
}

.palette__action:hover {
  border-color: rgba(88, 249, 255, 0.42);
  background: rgba(88, 249, 255, 0.08);
}

.palette__action span {
  color: var(--accent-amber);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
}

.palette__action strong {
  min-width: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.palette__action p,
.palette__empty {
  min-width: 0;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

@media (max-width: 620px) {
  .palette {
    top: 8px;
  }

  .palette__action {
    grid-template-columns: 1fr;
  }
}
</style>
