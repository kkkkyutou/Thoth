<script setup lang="ts">
import PluginDebugPanel from '@/components/v2/PluginDebugPanel.vue'
import ToolPluginPanel from '@/components/visual/ToolPluginPanel.vue'
import TodoPanel from '@/components/todo/TodoPanel.vue'
import { useDashboardStore } from '@/stores/dashboard'

const store = useDashboardStore()
</script>

<template>
  <section class="plugins-panel">
    <article class="v2-card plugins-panel__hero">
      <div>
        <span>Extensions Workbench</span>
        <h2>Provider and Tool Debug</h2>
        <p>Read-only provider state stays separate from tool extensions and local todo helpers.</p>
      </div>
      <div class="plugins-panel__stats">
        <article>
          <span>extensions</span>
          <strong>{{ store.pluginSummary?.plugin_count ?? 0 }}</strong>
        </article>
        <article>
          <span>enabled</span>
          <strong>{{ store.pluginSummary?.enabled_plugin_count ?? 0 }}</strong>
        </article>
        <article>
          <span>tools</span>
          <strong>{{ store.toolPlugins.length }}</strong>
        </article>
      </div>
    </article>

    <div class="plugins-panel__grid">
      <article class="v2-card plugins-panel__debug">
        <PluginDebugPanel :summary="store.pluginSummary" :tools="store.toolPlugins" />
      </article>
      <article class="v2-card plugins-panel__tools">
        <header>
          <span>Tool Extensions</span>
          <strong>isolated actions</strong>
        </header>
        <ToolPluginPanel :tools="store.toolPlugins" />
      </article>
      <article class="v2-card plugins-panel__todo">
        <header>
          <span>Local Todo DB</span>
          <strong>write tool</strong>
        </header>
        <TodoPanel />
      </article>
    </div>
  </section>
</template>

<style scoped>
.plugins-panel {
  display: grid;
  gap: 16px;
}

.plugins-panel__hero,
.plugins-panel__debug,
.plugins-panel__tools,
.plugins-panel__todo {
  padding: 16px;
}

.plugins-panel__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  gap: 16px;
  align-items: center;
}

.plugins-panel__hero span,
.plugins-panel__stats span,
.plugins-panel__tools header span,
.plugins-panel__todo header span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.plugins-panel__hero h2 {
  margin-top: 6px;
  color: var(--text-primary);
  font-size: clamp(1.8rem, 3vw, 3.3rem);
}

.plugins-panel__hero p {
  margin-top: 8px;
  color: var(--text-muted);
}

.plugins-panel__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.plugins-panel__stats article {
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.plugins-panel__stats strong {
  display: block;
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 1.3rem;
}

.plugins-panel__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(340px, 0.9fr);
  gap: 16px;
  align-items: start;
}

.plugins-panel__tools header,
.plugins-panel__todo header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.plugins-panel__tools header strong,
.plugins-panel__todo header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

.plugins-panel__todo {
  grid-column: 2;
}

@media (max-width: 1080px) {
  .plugins-panel__hero,
  .plugins-panel__grid {
    grid-template-columns: 1fr;
  }

  .plugins-panel__todo {
    grid-column: auto;
  }
}
</style>
