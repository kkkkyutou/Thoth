<script setup lang="ts">
const props = defineProps<{
  healthy: boolean
  message: string
  compiler?: Record<string, unknown>
}>()

const checks = ['authority', 'object graph', 'runs', 'extensions']
</script>

<template>
  <div class="health-matrix">
    <div
      v-for="check in checks"
      :key="check"
      class="health-matrix__cell"
      :class="{ 'health-matrix__cell--ok': props.healthy }"
    >
      <span>{{ check }}</span>
      <strong>{{ props.healthy ? 'ok' : 'watch' }}</strong>
    </div>
    <p>{{ props.message }}</p>
  </div>
</template>

<style scoped>
.health-matrix {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.health-matrix__cell {
  min-height: 56px;
  display: grid;
  place-content: center;
  border: 1px solid rgba(255, 180, 84, 0.4);
  border-radius: 8px;
  text-align: center;
}
.health-matrix__cell--ok {
  border-color: rgba(82, 240, 255, 0.46);
}
.health-matrix__cell span {
  color: var(--text-muted);
  font-size: 0.72rem;
}
.health-matrix__cell strong {
  color: var(--text-primary);
}
.health-matrix p {
  grid-column: 1 / -1;
  color: var(--text-muted);
  font-size: 0.82rem;
}
</style>
