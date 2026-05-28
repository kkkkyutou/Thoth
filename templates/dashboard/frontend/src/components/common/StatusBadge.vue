<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: string
}>()

const statusConfig = computed(() => {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    pending:     { label: '待开始', bg: 'rgba(247, 241, 232, 0.1)', fg: '#d8cec4' },
    in_progress: { label: '进行中', bg: 'rgba(255, 180, 84, 0.18)', fg: '#ffb454' },
    completed:   { label: '已完成', bg: 'rgba(82, 240, 255, 0.16)', fg: '#52f0ff' },
    blocked:     { label: '已阻塞', bg: 'rgba(255, 92, 112, 0.18)', fg: '#ff5c70' },
    ready:       { label: '可执行', bg: 'rgba(210, 31, 60, 0.22)', fg: '#f7f1e8' },
    invalid:     { label: '无效', bg: 'rgba(255, 122, 144, 0.18)', fg: '#ff7a90' },
    failed:      { label: '失败', bg: 'rgba(185, 22, 45, 0.28)', fg: '#ff5c70' },
    skipped:     { label: '已跳过', bg: 'rgba(247, 241, 232, 0.08)', fg: '#a99f99' },
  }
  return map[props.status] ?? { label: props.status, bg: 'rgba(247, 241, 232, 0.1)', fg: '#d8cec4' }
})
</script>

<template>
  <span
    class="status-badge"
    :style="{
      backgroundColor: statusConfig.bg,
      color: statusConfig.fg,
    }"
  >
    {{ statusConfig.label }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  line-height: 1.6;
}
</style>
