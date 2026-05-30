<script setup lang="ts">
import type { PluginSummary, ToolPlugin } from '@/types'

defineProps<{
  summary: PluginSummary | null
  tools: ToolPlugin[]
}>()
</script>

<template>
  <article class="plugin-debug">
    <header>
      <span>Plugin Debug Panel</span>
      <strong>{{ summary?.enabled_plugin_count ?? 0 }}/{{ summary?.plugin_count ?? 0 }} enabled</strong>
    </header>

    <section class="plugin-debug__status">
      <div>
        <span>manifest</span>
        <strong>{{ summary?.manifest_path || 'missing' }}</strong>
      </div>
      <div>
        <span>metrics</span>
        <strong>{{ summary?.metrics_configured ? 'configured' : 'empty' }}</strong>
      </div>
      <div>
        <span>tools</span>
        <strong>{{ tools.length }}</strong>
      </div>
    </section>

    <section v-if="summary?.manifest_error || summary?.validation_errors?.length" class="plugin-debug__errors">
      <strong>Diagnostics</strong>
      <p v-if="summary?.manifest_error">{{ summary.manifest_error }}</p>
      <p v-for="error in summary?.validation_errors ?? []" :key="error">{{ error }}</p>
    </section>

    <section class="plugin-debug__grid">
      <article v-for="plugin in summary?.plugins ?? []" :key="plugin.id" class="plugin-debug__plugin">
        <div>
          <span>{{ plugin.id }}</span>
          <strong>{{ plugin.title }}</strong>
        </div>
        <p>{{ plugin.source }}</p>
        <div class="plugin-debug__chips">
          <span :class="{ hot: plugin.enabled }">{{ plugin.enabled ? 'enabled' : 'disabled' }}</span>
          <span v-for="surface in plugin.surfaces" :key="surface">{{ surface }}</span>
          <span v-for="capability in plugin.capabilities" :key="capability">{{ capability }}</span>
        </div>
      </article>
    </section>
  </article>
</template>

<style scoped>
.plugin-debug {
  display: grid;
  gap: 14px;
}

.plugin-debug header,
.plugin-debug__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.plugin-debug header span,
.plugin-debug__status span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.plugin-debug header strong,
.plugin-debug__status strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.plugin-debug__status {
  align-items: stretch;
}

.plugin-debug__status div {
  flex: 1;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.plugin-debug__errors {
  padding: 12px;
  border: 1px solid rgba(255, 46, 87, 0.28);
  border-radius: var(--radius-xs);
  background: rgba(255, 46, 87, 0.08);
}

.plugin-debug__errors strong {
  color: var(--accent-primary);
}

.plugin-debug__errors p {
  margin-top: 6px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.plugin-debug__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.plugin-debug__plugin {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.plugin-debug__plugin span {
  color: var(--accent-amber);
  font-family: var(--font-mono);
  font-size: 0.72rem;
}

.plugin-debug__plugin strong {
  display: block;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.plugin-debug__plugin p {
  color: var(--text-muted);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.plugin-debug__chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.plugin-debug__chips span {
  padding: 3px 7px;
  border: 1px solid rgba(247, 241, 232, 0.12);
  border-radius: 999px;
  color: var(--text-muted);
}

.plugin-debug__chips .hot {
  border-color: rgba(88, 249, 255, 0.36);
  color: var(--accent-cyan);
}

@media (max-width: 840px) {
  .plugin-debug__status,
  .plugin-debug__grid {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
