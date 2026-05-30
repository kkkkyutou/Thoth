<script setup lang="ts">
import { computed } from 'vue'
import type { RunSummary } from '@/types'
import { clampPercent, formatTime, isRunActive } from '@/utils/format'

const props = defineProps<{
  runs: RunSummary[]
}>()

const activeRun = computed(
  () => props.runs.find((run) => isRunActive(run)) ?? props.runs[0] ?? null,
)

const progress = computed(() => clampPercent(activeRun.value?.progress_pct ?? 0))
const needleStyle = computed(() => ({
  transform: `rotate(${progress.value * 1.8 - 90}deg)`,
}))
const stateLabel = computed(() => activeRun.value?.status ?? 'idle')
const phaseLabel = computed(() => activeRun.value?.phase ?? 'standby')
</script>

<template>
  <article class="instrument" :class="{ 'instrument--active': activeRun && isRunActive(activeRun) }">
    <div class="instrument__dial">
      <div class="instrument__ticks" aria-hidden="true"></div>
      <div class="instrument__needle" :style="needleStyle"></div>
      <div class="instrument__hub"></div>
      <div class="instrument__readout">
        <strong>{{ progress.toFixed(0) }}%</strong>
        <span>{{ stateLabel }}</span>
      </div>
    </div>
    <div class="instrument__body">
      <div>
        <span>active run</span>
        <strong>{{ activeRun?.run_id ?? 'no-live-run' }}</strong>
      </div>
      <div class="instrument__grid">
        <p><span>phase</span>{{ phaseLabel }}</p>
        <p><span>executor</span>{{ activeRun?.executor ?? 'unknown' }}</p>
        <p><span>host</span>{{ activeRun?.host ?? 'unknown' }}</p>
        <p><span>heartbeat</span>{{ formatTime(activeRun?.last_heartbeat_at) }}</p>
      </div>
      <div class="instrument__message">
        {{ activeRun?.latest_message || 'Runtime bus is quiet.' }}
      </div>
    </div>
    <div class="instrument__pistons" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
  </article>
</template>

<style scoped>
.instrument {
  position: relative;
  display: grid;
  grid-template-columns: 158px minmax(0, 1fr);
  gap: 18px;
  min-height: 196px;
  padding: 18px;
  border: 1px solid rgba(88, 249, 255, 0.26);
  border-radius: var(--radius);
  background:
    radial-gradient(circle at 22% 34%, rgba(88, 249, 255, 0.14), transparent 28%),
    linear-gradient(135deg, rgba(255, 46, 87, 0.18), rgba(10, 12, 15, 0.9) 42%),
    rgba(8, 9, 11, 0.96);
  box-shadow: 0 0 0 1px rgba(255, 46, 87, 0.1), 0 22px 70px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.instrument--active {
  border-color: rgba(88, 249, 255, 0.58);
}

.instrument__dial {
  position: relative;
  width: 148px;
  height: 148px;
  align-self: center;
  border: 1px solid rgba(247, 241, 232, 0.24);
  border-radius: 50%;
  background:
    conic-gradient(from 225deg, #ff2e57 0deg, #ffb454 92deg, #58f9ff 170deg, rgba(247, 241, 232, 0.08) 171deg),
    radial-gradient(circle, #0a0c0f 0 52%, transparent 53%),
    #101318;
  box-shadow: inset 0 0 28px rgba(0, 0, 0, 0.72), 0 0 26px rgba(88, 249, 255, 0.14);
}

.instrument__ticks {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background: repeating-conic-gradient(
    from -90deg,
    rgba(247, 241, 232, 0.52) 0deg 1deg,
    transparent 1deg 10deg
  );
  mask: radial-gradient(circle, transparent 0 58%, #000 59% 100%);
}

.instrument__needle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 58px;
  height: 2px;
  transform-origin: 0 50%;
  background: #f7f1e8;
  box-shadow: 0 0 16px rgba(255, 46, 87, 0.8);
  transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.instrument__hub {
  position: absolute;
  left: calc(50% - 8px);
  top: calc(50% - 8px);
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ff2e57;
  box-shadow: 0 0 24px rgba(255, 46, 87, 0.8);
}

.instrument__readout {
  position: absolute;
  inset: auto 26px 22px;
  display: grid;
  justify-items: center;
  line-height: 1.05;
}

.instrument__readout strong {
  font-family: var(--font-mono);
  font-size: 1.55rem;
}

.instrument__readout span,
.instrument__body span,
.instrument__grid span {
  color: var(--text-muted);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.instrument__body {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.instrument__body strong {
  display: block;
  margin-top: 3px;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 1.05rem;
  color: var(--text-primary);
}

.instrument__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.instrument__grid p {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.035);
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}

.instrument__grid span {
  display: block;
  margin-bottom: 4px;
  font-family: var(--font-sans);
}

.instrument__message {
  min-height: 40px;
  padding: 10px 12px;
  border-left: 2px solid var(--accent-cyan);
  background: rgba(88, 249, 255, 0.06);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.instrument__pistons {
  position: absolute;
  right: 12px;
  bottom: 10px;
  display: flex;
  gap: 5px;
}

.instrument__pistons span {
  width: 4px;
  height: 28px;
  border-radius: 999px;
  background: rgba(88, 249, 255, 0.38);
  animation: piston 0.9s ease-in-out infinite;
}

.instrument__pistons span:nth-child(2) {
  animation-delay: 0.16s;
}

.instrument__pistons span:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes piston {
  0%,
  100% {
    transform: scaleY(0.45);
    opacity: 0.45;
  }
  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

@media (max-width: 620px) {
  .instrument {
    grid-template-columns: 1fr;
  }

  .instrument__dial {
    justify-self: center;
  }
}
</style>
