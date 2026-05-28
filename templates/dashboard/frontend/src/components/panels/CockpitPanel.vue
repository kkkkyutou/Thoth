<script setup lang="ts">
import { computed } from 'vue'
import ArtifactRail from '@/components/visual/ArtifactRail.vue'
import AuthorityGraph from '@/components/visual/AuthorityGraph.vue'
import DependencyDag from '@/components/visual/DependencyDag.vue'
import EventTimeline from '@/components/visual/EventTimeline.vue'
import GanttLane from '@/components/visual/GanttLane.vue'
import GpuResourceBars from '@/components/visual/GpuResourceBars.vue'
import HealthMatrix from '@/components/visual/HealthMatrix.vue'
import LossCurvePanel from '@/components/visual/LossCurvePanel.vue'
import NeonProgressRing from '@/components/visual/NeonProgressRing.vue'
import ProgressStackBar from '@/components/visual/ProgressStackBar.vue'
import RunPhaseStepper from '@/components/visual/RunPhaseStepper.vue'
import ToolPluginPanel from '@/components/visual/ToolPluginPanel.vue'
import WorkItemMatrix from '@/components/visual/WorkItemMatrix.vue'
import { locale } from '@/locales'
import { useDashboardStore } from '@/stores/dashboard'
import type { MetricsProviderPayload, RunSummary } from '@/types'

const store = useDashboardStore()

const summary = computed(() => store.overviewSummary)
const projectName = computed(() => summary.value?.project?.name || store.config?.project?.name || locale.brand)
const projectDescription = computed(
  () => summary.value?.project?.description || store.config?.project?.description || 'Read-only Thoth authority cockpit.',
)

const authoritySummary = computed(() => {
  const authority = store.observeSnapshot?.providers.authority as
    | { summary?: Record<string, unknown> }
    | undefined
  return authority?.summary ?? {}
})

const workStatusCounts = computed(() => {
  const provider = store.observeSnapshot?.providers.work_items as
    | { status_counts?: Record<string, number> }
    | undefined
  return provider?.status_counts ?? store.progress?.status_counts ?? {}
})

const runs = computed<RunSummary[]>(() => {
  const provider = store.observeSnapshot?.providers.runs as
    | { runs?: RunSummary[] }
    | undefined
  return provider?.runs ?? store.progress?.runtime.active_runs ?? []
})

const metrics = computed<MetricsProviderPayload | null>(() => {
  if (store.metricsProvider) return store.metricsProvider
  const provider = store.observeSnapshot?.providers.metrics as MetricsProviderPayload | undefined
  return provider ?? null
})

const gpuRows = computed(() => {
  const system = store.observeSnapshot?.providers.system as
    | { gpu?: { gpus?: Array<Record<string, unknown>> } }
    | undefined
  return system?.gpu?.gpus ?? []
})

const blockedCount = computed(() => summary.value?.headline.blocked_work_items ?? 0)
const readyCount = computed(() => summary.value?.headline.ready_work_items ?? 0)
const totalCount = computed(() => summary.value?.headline.total_work_items ?? 0)

function openWorkItem(workId: string) {
  void store.selectWorkItem(workId)
}
</script>

<template>
  <section class="cockpit">
    <section class="cockpit__mast">
      <div class="cockpit__identity">
        <span class="cockpit__eyebrow">{{ locale.cockpit.title }}</span>
        <h2>{{ projectName }}</h2>
        <p>{{ projectDescription }}</p>
      </div>
      <div class="cockpit__rings">
        <NeonProgressRing
          :value="summary?.headline.overall_progress ?? 0"
          label="validated"
          tone="red"
        />
        <NeonProgressRing
          :value="totalCount ? (readyCount / totalCount) * 100 : 0"
          label="ready"
          tone="cyan"
        />
        <NeonProgressRing
          :value="totalCount ? (blockedCount / totalCount) * 100 : 0"
          label="blocked"
          tone="amber"
        />
      </div>
    </section>

    <section class="cockpit__strip" aria-label="headline counts">
      <article>
        <span>work items</span>
        <strong>{{ totalCount }}</strong>
      </article>
      <article>
        <span>active runs</span>
        <strong>{{ summary?.runtime.active_run_count ?? 0 }}</strong>
      </article>
      <article>
        <span>stale runs</span>
        <strong>{{ summary?.runtime.stale_run_count ?? 0 }}</strong>
      </article>
      <article>
        <span>plugins</span>
        <strong>{{ store.pluginSummary?.enabled_plugin_count ?? 0 }}</strong>
      </article>
      <article>
        <span>tools</span>
        <strong>{{ store.toolPlugins.length }}</strong>
      </article>
    </section>

    <section class="cockpit__grid">
      <article class="cockpit-card cockpit-card--wide">
        <header>
          <span>Authority Graph</span>
          <strong>canonical objects</strong>
        </header>
        <AuthorityGraph :summary="authoritySummary" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>Work Item Status</span>
          <strong>{{ totalCount }} total</strong>
        </header>
        <ProgressStackBar :counts="workStatusCounts" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>Health Matrix</span>
          <strong>{{ summary?.healthy ? 'ok' : 'watch' }}</strong>
        </header>
        <HealthMatrix
          :healthy="summary?.healthy ?? false"
          :message="summary?.health_message ?? 'No health payload yet.'"
          :compiler="summary?.compiler_summary"
        />
      </article>

      <article class="cockpit-card cockpit-card--wide">
        <header>
          <span>Loss / Metrics</span>
          <strong>{{ metrics?.record_count ?? 0 }} records</strong>
        </header>
        <LossCurvePanel :metrics="metrics" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>Run Phases</span>
          <strong>{{ runs.length }} ledgers</strong>
        </header>
        <RunPhaseStepper :runs="runs" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>GPU Resources</span>
          <strong>{{ gpuRows.length ? 'nvml' : 'empty' }}</strong>
        </header>
        <GpuResourceBars :rows="gpuRows" />
      </article>

      <article class="cockpit-card cockpit-card--wide">
        <header>
          <span>Work Item Matrix</span>
          <strong>authority/actionability</strong>
        </header>
        <WorkItemMatrix :items="store.workItems" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>Dependency DAG</span>
          <strong>{{ store.dag?.edges.length ?? 0 }} edges</strong>
        </header>
        <DependencyDag :dag="store.dag" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>Gantt Lane</span>
          <strong>{{ store.gantt.length }} rows</strong>
        </header>
        <GanttLane :rows="store.gantt" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>Artifacts</span>
          <strong>evidence rail</strong>
        </header>
        <ArtifactRail :runs="runs" />
      </article>

      <article class="cockpit-card">
        <header>
          <span>Tool Plugins</span>
          <strong>isolated</strong>
        </header>
        <ToolPluginPanel :tools="store.toolPlugins" />
      </article>

      <article class="cockpit-card cockpit-card--wide">
        <header>
          <span>Event Timeline</span>
          <strong>{{ summary?.recent_activity.length ?? 0 }} entries</strong>
        </header>
        <EventTimeline :events="summary?.recent_activity ?? []" />
      </article>

      <article class="cockpit-card cockpit-card--wide">
        <header>
          <span>Recent Conclusions</span>
          <strong>validated evidence</strong>
        </header>
        <div class="cockpit__conclusions">
          <button
            v-for="item in summary?.recent_conclusions ?? []"
            :key="item.work_id"
            @click="openWorkItem(item.work_id)"
          >
            <span>{{ item.work_id }} · {{ item.status }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.conclusion || item.evidence_paths.join(', ') || 'No conclusion text yet.' }}</p>
          </button>
          <p v-if="!(summary?.recent_conclusions?.length)" class="cockpit__empty">
            {{ locale.cockpit.empty }}
          </p>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.cockpit {
  display: grid;
  gap: 16px;
}

.cockpit__mast {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr);
  gap: 18px;
  align-items: center;
  min-height: 220px;
  padding: 22px;
  border: 1px solid rgba(210, 31, 60, 0.34);
  border-radius: var(--radius);
  background:
    linear-gradient(130deg, rgba(210, 31, 60, 0.16), transparent 42%),
    linear-gradient(90deg, rgba(82, 240, 255, 0.08), transparent 28%),
    rgba(10, 6, 7, 0.92);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.cockpit__identity {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.cockpit__eyebrow {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.cockpit__identity h2 {
  max-width: 900px;
  color: var(--text-primary);
  font-size: clamp(2rem, 4vw, 4.4rem);
  font-weight: 800;
  letter-spacing: 0;
}

.cockpit__identity p {
  max-width: 68ch;
  color: var(--text-secondary);
  font-size: 1rem;
}

.cockpit__rings {
  display: grid;
  grid-template-columns: repeat(3, minmax(96px, 1fr));
  justify-items: center;
  gap: 10px;
}

.cockpit__strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.cockpit__strip article,
.cockpit-card {
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background:
    linear-gradient(180deg, rgba(247, 241, 232, 0.055), transparent 44%),
    rgba(19, 9, 11, 0.88);
  box-shadow: var(--shadow-soft);
}

.cockpit__strip article {
  min-height: 82px;
  padding: 14px;
  display: grid;
  align-content: center;
  gap: 4px;
}

.cockpit__strip span,
.cockpit-card header span {
  color: var(--text-muted);
  font-size: 0.74rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.cockpit__strip strong {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 1.65rem;
}

.cockpit__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.cockpit-card {
  min-height: 210px;
  padding: 16px;
  overflow: hidden;
}

.cockpit-card--wide {
  grid-column: span 2;
}

.cockpit-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.cockpit-card header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.76rem;
  font-weight: 700;
  white-space: nowrap;
}

.cockpit__conclusions {
  display: grid;
  gap: 10px;
}

.cockpit__conclusions button {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius);
  background: rgba(247, 241, 232, 0.045);
  text-align: left;
}

.cockpit__conclusions button:hover {
  border-color: rgba(210, 31, 60, 0.5);
  background: rgba(210, 31, 60, 0.08);
}

.cockpit__conclusions span {
  color: var(--accent-amber);
  font-family: var(--font-mono);
  font-size: 0.76rem;
}

.cockpit__conclusions strong {
  color: var(--text-primary);
}

.cockpit__conclusions p,
.cockpit__empty {
  color: var(--text-muted);
  font-size: 0.82rem;
}

@media (max-width: 1240px) {
  .cockpit__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .cockpit__mast,
  .cockpit__strip,
  .cockpit__grid {
    grid-template-columns: 1fr;
  }

  .cockpit-card--wide {
    grid-column: auto;
  }

  .cockpit__rings {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 540px) {
  .cockpit__rings {
    grid-template-columns: 1fr;
  }
}
</style>
