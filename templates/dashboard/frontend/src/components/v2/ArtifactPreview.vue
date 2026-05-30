<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  path: string
}>()

const extension = computed(() => props.path.split('.').pop()?.toLowerCase() ?? 'artifact')
const basename = computed(() => props.path.split('/').pop() ?? props.path)
const kind = computed(() => {
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension.value)) return 'image'
  if (['json', 'jsonl', 'log', 'txt', 'md'].includes(extension.value)) return 'text'
  if (['csv', 'tsv', 'parquet'].includes(extension.value)) return 'data'
  return 'file'
})
</script>

<template>
  <article class="artifact-preview">
    <div class="artifact-preview__icon">{{ kind }}</div>
    <div>
      <strong>{{ basename }}</strong>
      <p>{{ path }}</p>
    </div>
  </article>
</template>

<style scoped>
.artifact-preview {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
  background: rgba(247, 241, 232, 0.04);
}

.artifact-preview__icon {
  display: grid;
  place-items: center;
  min-height: 46px;
  border: 1px solid rgba(88, 249, 255, 0.28);
  border-radius: var(--radius-xs);
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  text-transform: uppercase;
}

.artifact-preview strong {
  display: block;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.artifact-preview p {
  margin-top: 3px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}
</style>
