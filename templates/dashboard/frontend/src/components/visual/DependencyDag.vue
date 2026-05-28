<script setup lang="ts">
import type { DagData } from '@/types'

const props = defineProps<{
  dag: DagData | null
}>()
</script>

<template>
  <div class="dependency-dag">
    <div class="dependency-dag__stats">
      <span>nodes <strong>{{ props.dag?.nodes.length ?? 0 }}</strong></span>
      <span>edges <strong>{{ props.dag?.edges.length ?? 0 }}</strong></span>
    </div>
    <div class="dependency-dag__nodes">
      <span v-for="node in props.dag?.nodes.slice(0, 18) ?? []" :key="node.id">
        {{ node.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.dependency-dag {
  display: grid;
  gap: 12px;
}
.dependency-dag__stats {
  display: flex;
  gap: 16px;
  color: var(--text-muted);
}
.dependency-dag__stats strong {
  color: var(--text-primary);
}
.dependency-dag__nodes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dependency-dag__nodes span {
  padding: 6px 9px;
  border: 1px solid rgba(82, 240, 255, 0.28);
  border-radius: 8px;
  color: var(--text-primary);
  background: rgba(82, 240, 255, 0.07);
  font-size: 0.76rem;
}
</style>
