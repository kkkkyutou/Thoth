<script setup lang="ts">
const props = withDefaults(defineProps<{
  value: number
  label: string
  tone?: 'red' | 'cyan' | 'amber'
}>(), {
  tone: 'red',
})

const radius = 42
const circumference = 2 * Math.PI * radius
</script>

<template>
  <div class="neon-ring" :class="`neon-ring--${props.tone}`">
    <svg viewBox="0 0 112 112" aria-hidden="true">
      <circle class="neon-ring__track" cx="56" cy="56" :r="radius" />
      <circle
        class="neon-ring__value"
        cx="56"
        cy="56"
        :r="radius"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="circumference * (1 - Math.max(0, Math.min(100, props.value)) / 100)"
      />
    </svg>
    <div class="neon-ring__label">
      <strong>{{ Math.round(props.value) }}%</strong>
      <span>{{ props.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.neon-ring {
  position: relative;
  width: 136px;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}
.neon-ring svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  filter: drop-shadow(0 0 14px rgba(210, 31, 60, 0.36));
}
.neon-ring__track,
.neon-ring__value {
  fill: none;
  stroke-width: 9;
}
.neon-ring__track {
  stroke: rgba(247, 241, 232, 0.12);
}
.neon-ring__value {
  stroke: var(--accent-primary);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.7s ease;
}
.neon-ring--cyan .neon-ring__value { stroke: var(--accent-cyan); }
.neon-ring--amber .neon-ring__value { stroke: var(--accent-amber); }
.neon-ring__label {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
}
.neon-ring__label strong {
  font-size: 1.8rem;
  line-height: 1;
}
.neon-ring__label span {
  color: var(--text-muted);
  font-size: 0.76rem;
  margin-top: 4px;
}
</style>
