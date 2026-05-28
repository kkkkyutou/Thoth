<script setup lang="ts">
const props = defineProps<{
  events: string[]
}>()

function title(entry: string): string {
  return entry.split('\n')[0]?.replace(/^- /, '') || entry
}
</script>

<template>
  <ol class="event-timeline">
    <li v-for="entry in props.events.slice(0, 6)" :key="entry">
      <strong>{{ title(entry) }}</strong>
      <p>{{ entry }}</p>
    </li>
    <li v-if="!props.events.length" class="event-timeline__empty">No recent activity.</li>
  </ol>
</template>

<style scoped>
.event-timeline {
  display: grid;
  gap: 12px;
  list-style: none;
}
.event-timeline li {
  position: relative;
  padding-left: 22px;
}
.event-timeline li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--accent-primary);
  box-shadow: 0 0 12px var(--accent-primary);
}
.event-timeline strong {
  color: var(--text-primary);
}
.event-timeline p {
  max-height: 44px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 0.78rem;
}
.event-timeline__empty {
  color: var(--text-muted);
}
</style>
