<script setup lang="ts">
const props = defineProps<{
  values: number[]
  label: string
}>()

function points(): string {
  if (!props.values.length) return ''
  const width = 220
  const height = 54
  const min = Math.min(...props.values)
  const max = Math.max(...props.values)
  const span = Math.max(0.000001, max - min)
  return props.values
    .map((value, index) => {
      const x = props.values.length === 1 ? 0 : (index / (props.values.length - 1)) * width
      const y = height - ((value - min) / span) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
</script>

<template>
  <div class="spark">
    <span>{{ props.label }}</span>
    <svg viewBox="0 0 220 54" preserveAspectRatio="none" aria-hidden="true">
      <polyline :points="points()" />
    </svg>
  </div>
</template>

<style scoped>
.spark {
  display: grid;
  gap: 6px;
}
.spark span {
  color: var(--text-muted);
  font-size: 0.76rem;
}
.spark svg {
  width: 100%;
  height: 54px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(210, 31, 60, 0.16), rgba(247, 241, 232, 0.03));
}
.spark polyline {
  fill: none;
  stroke: var(--accent-cyan);
  stroke-width: 2.5;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 6px rgba(82, 240, 255, 0.7));
}
</style>
