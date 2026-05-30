<script setup lang="ts">
import { computed } from 'vue'
import { VueFlow, type Edge, type Node } from '@vue-flow/core'
import dagre from 'dagre'
import { useDashboardStore } from '@/stores/dashboard'

const store = useDashboardStore()

const graphPayload = computed(() => {
  const dag = store.dag
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 84 })

  const sourceNodes = (dag?.nodes ?? []).slice(0, 36)
  for (const node of sourceNodes) {
    graph.setNode(node.id, { width: 190, height: 72 })
  }
  for (const edge of dag?.edges ?? []) {
    if (sourceNodes.some((node) => node.id === edge.source) && sourceNodes.some((node) => node.id === edge.target)) {
      graph.setEdge(edge.source, edge.target)
    }
  }
  dagre.layout(graph)

  const nodes: Node[] = sourceNodes.map((node) => {
    const layout = graph.node(node.id) as { x?: number; y?: number } | undefined
    return {
      id: node.id,
      type: 'default',
      label: `${node.label}\n${node.status ?? node.type}`,
      position: {
        x: (layout?.x ?? 0) - 95,
        y: (layout?.y ?? 0) - 36,
      },
      data: {
        status: node.status ?? node.actionability ?? node.type,
      },
      class: `authority-node authority-node--${(node.status ?? node.type).replace(/_/g, '-')}`,
    }
  })

  const edges: Edge[] = (dag?.edges ?? [])
    .filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target))
    .slice(0, 64)
    .map((edge) => ({
      id: `${edge.source}-${edge.target}-${edge.type}`,
      source: edge.source,
      target: edge.target,
      label: edge.type,
      animated: edge.type === 'hard',
      class: `authority-edge authority-edge--${edge.type}`,
    }))

  return { nodes, edges }
})

const layoutLabel = computed(() => 'dagre layout')
</script>

<template>
  <article class="authority-flow">
    <header>
      <span>Authority Flow</span>
      <strong>{{ layoutLabel }}</strong>
    </header>
    <div class="authority-flow__canvas">
      <VueFlow
        :nodes="graphPayload.nodes"
        :edges="graphPayload.edges"
        fit-view-on-init
        :nodes-draggable="false"
        :nodes-connectable="false"
      >
      </VueFlow>
      <p v-if="!graphPayload.nodes.length" class="authority-flow__empty">No DAG read model available.</p>
    </div>
  </article>
</template>

<style scoped>
.authority-flow {
  display: grid;
  gap: 12px;
}

.authority-flow header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.authority-flow header span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.authority-flow header strong {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

.authority-flow__canvas {
  position: relative;
  height: 420px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background:
    radial-gradient(circle at 24% 12%, rgba(88, 249, 255, 0.1), transparent 26%),
    rgba(8, 9, 11, 0.92);
  overflow: hidden;
}

.authority-flow__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  pointer-events: none;
}

:deep(.vue-flow__node) {
  border: 1px solid rgba(88, 249, 255, 0.28);
  border-radius: 8px;
  background: rgba(19, 9, 11, 0.96);
  color: var(--text-primary);
  white-space: pre-line;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.34);
}

:deep(.vue-flow__edge-path) {
  stroke: rgba(88, 249, 255, 0.58);
}

:deep(.authority-edge--soft .vue-flow__edge-path) {
  stroke: rgba(255, 180, 84, 0.58);
  stroke-dasharray: 6 4;
}
</style>
