<script setup lang="ts">
import type { ToolPlugin } from '@/types'

const props = defineProps<{
  tools: ToolPlugin[]
}>()
</script>

<template>
  <div class="tool-plugin-panel">
    <article v-for="tool in props.tools" :key="tool.id" class="tool-plugin-panel__tool">
      <div>
        <strong>{{ tool.title || tool.id }}</strong>
        <p>{{ tool.description || 'Dashboard tool extension' }}</p>
      </div>
      <span>{{ (tool.capabilities || []).join(' / ') || 'tool' }}</span>
    </article>
    <p v-if="!props.tools.length" class="tool-plugin-panel__empty">No tool extensions enabled.</p>
  </div>
</template>

<style scoped>
.tool-plugin-panel {
  display: grid;
  gap: 10px;
}
.tool-plugin-panel__tool {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border: 1px solid rgba(210, 31, 60, 0.35);
  border-radius: 8px;
  background: rgba(210, 31, 60, 0.08);
}
.tool-plugin-panel__tool strong {
  color: var(--text-primary);
}
.tool-plugin-panel__tool p,
.tool-plugin-panel__tool span,
.tool-plugin-panel__empty {
  color: var(--text-muted);
  font-size: 0.78rem;
}
.tool-plugin-panel__tool span {
  align-self: center;
  max-width: 180px;
  text-align: right;
}
</style>
