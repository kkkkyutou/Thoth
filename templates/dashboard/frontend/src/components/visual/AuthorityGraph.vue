<script setup lang="ts">
const props = defineProps<{
  summary: Record<string, unknown>
}>()

const nodes = ['discussion', 'decision', 'work_item', 'run', 'artifact']

function countFor(node: string): string {
  const value = props.summary[`${node}_counts`]
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, number>).reduce((sum, item) => sum + Number(item || 0), 0).toString()
  }
  return '0'
}
</script>

<template>
  <div class="authority-graph">
    <div v-for="(node, index) in nodes" :key="node" class="authority-graph__node">
      <span>{{ node }}</span>
      <strong>{{ countFor(node) }}</strong>
      <i v-if="index < nodes.length - 1" />
    </div>
  </div>
</template>

<style scoped>
.authority-graph {
  display: grid;
  grid-template-columns: repeat(5, minmax(90px, 1fr));
  gap: 10px;
}
.authority-graph__node {
  position: relative;
  min-height: 74px;
  display: grid;
  place-content: center;
  gap: 4px;
  border: 1px solid rgba(210, 31, 60, 0.55);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(210, 31, 60, 0.18), rgba(247, 241, 232, 0.04)),
    rgba(12, 7, 8, 0.86);
  text-align: center;
}
.authority-graph__node span {
  color: var(--text-muted);
  font-size: 0.72rem;
}
.authority-graph__node strong {
  color: var(--text-primary);
  font-size: 1.4rem;
}
.authority-graph__node i {
  position: absolute;
  right: -11px;
  top: 50%;
  width: 12px;
  height: 2px;
  background: var(--accent-primary);
  box-shadow: 0 0 10px var(--accent-primary);
}
@media (max-width: 820px) {
  .authority-graph {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .authority-graph__node i {
    display: none;
  }
}
</style>
