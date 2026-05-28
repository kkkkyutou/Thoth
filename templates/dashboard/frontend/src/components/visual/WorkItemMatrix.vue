<script setup lang="ts">
import type { WorkItem } from '@/types'

const props = defineProps<{
  items: WorkItem[]
}>()

function statusOf(item: WorkItem): string {
  return item.authority_status || item.ready_state || item.computed_status || 'pending'
}
</script>

<template>
  <div class="matrix">
    <button
      v-for="item in props.items.slice(0, 48)"
      :key="item.id || item.work_id"
      class="matrix__cell"
      :class="`matrix__cell--${statusOf(item)}`"
      :title="`${item.work_id || item.id}: ${item.title}`"
    >
      <span>{{ item.work_id || item.id }}</span>
    </button>
    <p v-if="!props.items.length" class="matrix__empty">No work items.</p>
  </div>
</template>

<style scoped>
.matrix {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 8px;
}
.matrix__cell {
  min-height: 54px;
  border: 1px solid rgba(247, 241, 232, 0.12);
  border-radius: 8px;
  background: rgba(247, 241, 232, 0.05);
  color: var(--text-primary);
  overflow: hidden;
}
.matrix__cell span {
  display: block;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 0.72rem;
}
.matrix__cell--ready,
.matrix__cell--active {
  border-color: rgba(210, 31, 60, 0.65);
  box-shadow: 0 0 18px rgba(210, 31, 60, 0.22);
}
.matrix__cell--validated {
  border-color: rgba(82, 240, 255, 0.55);
  box-shadow: 0 0 18px rgba(82, 240, 255, 0.18);
}
.matrix__cell--blocked,
.matrix__cell--failed,
.matrix__cell--invalid {
  border-color: rgba(255, 92, 112, 0.7);
}
.matrix__empty {
  color: var(--text-muted);
}
</style>
