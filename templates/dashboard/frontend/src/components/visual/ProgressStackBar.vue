<script setup lang="ts">
const props = defineProps<{
  counts: Record<string, number>
}>()

const order = ['validated', 'completed', 'ready', 'active', 'failed', 'blocked', 'draft', 'invalid']

function total(): number {
  return Object.values(props.counts).reduce((sum, value) => sum + Number(value || 0), 0)
}

function pct(value: number): string {
  const denominator = Math.max(1, total())
  return `${Math.max(2, (Number(value || 0) / denominator) * 100)}%`
}
</script>

<template>
  <div class="stack">
    <div class="stack__bar">
      <span
        v-for="key in order.filter((item) => props.counts[item])"
        :key="key"
        class="stack__seg"
        :class="`stack__seg--${key}`"
        :style="{ width: pct(props.counts[key]) }"
        :title="`${key}: ${props.counts[key]}`"
      />
    </div>
    <div class="stack__legend">
      <span v-for="key in order.filter((item) => props.counts[item])" :key="key">
        <i :class="`stack__dot stack__dot--${key}`" />{{ key }} {{ props.counts[key] }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.stack {
  display: grid;
  gap: 10px;
}
.stack__bar {
  display: flex;
  height: 13px;
  overflow: hidden;
  border: 1px solid rgba(247, 241, 232, 0.14);
  border-radius: 999px;
  background: rgba(247, 241, 232, 0.06);
}
.stack__seg {
  min-width: 2%;
  box-shadow: 0 0 16px currentColor;
}
.stack__seg--validated,
.stack__seg--completed,
.stack__dot--validated,
.stack__dot--completed { color: var(--accent-cyan); background: var(--accent-cyan); }
.stack__seg--ready,
.stack__dot--ready { color: var(--accent-primary); background: var(--accent-primary); }
.stack__seg--active,
.stack__dot--active { color: var(--accent-amber); background: var(--accent-amber); }
.stack__seg--blocked,
.stack__seg--failed,
.stack__seg--invalid,
.stack__dot--blocked,
.stack__dot--failed,
.stack__dot--invalid { color: #ff5c70; background: #ff5c70; }
.stack__seg--draft,
.stack__dot--draft { color: #8b8380; background: #8b8380; }
.stack__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: var(--text-muted);
  font-size: 0.78rem;
}
.stack__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.stack__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}
</style>
