<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  FlexRender,
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useVueTable,
  type SortingState,
} from '@tanstack/vue-table'
import { useVirtualizer } from '@tanstack/vue-virtual'
import WorkItemDetail from '@/components/detail/WorkItemDetail.vue'
import AuthorityFlow from '@/components/v2/AuthorityFlow.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { WorkItem } from '@/types'
import { clampPercent, shortText } from '@/utils/format'

const store = useDashboardStore()
const search = ref('')
const sorting = ref<SortingState>([])
const tableScroll = ref<HTMLElement | null>(null)
const columnHelper = createColumnHelper<WorkItem>()

const filteredItems = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return store.workItems
  return store.workItems.filter((item) =>
    `${item.id} ${item.title} ${item.module} ${item.direction} ${item.computed_status}`
      .toLowerCase()
      .includes(needle),
  )
})

const columns = [
  columnHelper.accessor('id', {
    header: 'Work ID',
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor('title', {
    header: 'Title',
    cell: (info) => shortText(info.getValue(), 'Untitled work item', 72),
  }),
  columnHelper.accessor('computed_status', {
    header: 'Status',
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor('computed_progress', {
    header: 'Progress',
    cell: (info) => `${clampPercent(info.getValue()).toFixed(0)}%`,
  }),
  columnHelper.accessor('run_count', {
    header: 'Runs',
    cell: (info) => info.getValue() ?? 0,
  }),
]

const table = useVueTable({
  data: filteredItems,
  columns,
  state: {
    get sorting() {
      return sorting.value
    },
  },
  onSortingChange: (updaterOrValue) => {
    sorting.value =
      typeof updaterOrValue === 'function' ? updaterOrValue(sorting.value) : updaterOrValue
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
})

const tableRows = computed(() => table.getRowModel().rows)
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: tableRows.value.length,
    getScrollElement: () => tableScroll.value,
    estimateSize: () => 44,
    overscan: 14,
  })),
)
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())
const virtualPaddingTop = computed(() => virtualRows.value[0]?.start ?? 0)
const virtualPaddingBottom = computed(() => {
  const last = virtualRows.value[virtualRows.value.length - 1]
  return Math.max(0, totalSize.value - (last?.end ?? 0))
})

function selectItem(item: WorkItem) {
  void store.selectWorkItem(item.id)
}
</script>

<template>
  <section class="work-panel">
    <article class="v2-card work-panel__graph">
      <AuthorityFlow />
    </article>

    <div class="work-panel__grid">
      <article class="v2-card work-panel__table-card">
        <header class="work-panel__header">
          <div>
            <span>Work Matrix</span>
            <strong>{{ filteredItems.length }} visible / {{ store.workItems.length }} total</strong>
          </div>
          <input v-model="search" placeholder="Filter work items..." />
        </header>
        <div ref="tableScroll" class="work-panel__table-wrap">
          <table class="work-panel__table">
            <thead>
              <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
                <th v-for="header in headerGroup.headers" :key="header.id">
                  <button v-if="!header.isPlaceholder" @click="header.column.getToggleSortingHandler()?.($event)">
                    <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                    <span>{{ { asc: '↑', desc: '↓' }[header.column.getIsSorted() as string] }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="virtualPaddingTop > 0" class="work-panel__spacer">
                <td :colspan="columns.length" :style="{ height: `${virtualPaddingTop}px` }"></td>
              </tr>
              <tr
                v-for="virtualRow in virtualRows"
                :key="tableRows[virtualRow.index].id"
                :class="{ selected: store.selectedWorkItem?.id === tableRows[virtualRow.index].original.id }"
                @click="selectItem(tableRows[virtualRow.index].original)"
              >
                <td v-for="cell in tableRows[virtualRow.index].getVisibleCells()" :key="cell.id">
                  <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                </td>
              </tr>
              <tr v-if="virtualPaddingBottom > 0" class="work-panel__spacer">
                <td :colspan="columns.length" :style="{ height: `${virtualPaddingBottom}px` }"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="v2-card work-panel__detail">
        <WorkItemDetail v-if="store.selectedWorkItem" :key="store.selectedWorkItem.id" />
        <div v-else class="work-panel__empty">
          <span>Artifact-aware detail dock</span>
          <strong>Select a work item</strong>
          <p>Click a row to inspect authority, readiness, runs, validator evidence and phase cards.</p>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.work-panel {
  display: grid;
  gap: 16px;
}

.work-panel__graph,
.work-panel__table-card,
.work-panel__detail {
  padding: 16px;
}

.work-panel__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  gap: 16px;
  align-items: start;
}

.work-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.work-panel__header span {
  display: block;
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.work-panel__header strong {
  color: var(--text-primary);
}

.work-panel__header input {
  width: min(280px, 100%);
}

.work-panel__table-wrap {
  max-height: 620px;
  overflow: auto;
  border: 1px solid rgba(247, 241, 232, 0.1);
  border-radius: var(--radius-xs);
}

.work-panel__table {
  width: 100%;
  border-collapse: collapse;
  min-width: 720px;
}

.work-panel__table th,
.work-panel__table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(247, 241, 232, 0.08);
  text-align: left;
  vertical-align: top;
}

.work-panel__table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgba(8, 9, 11, 0.96);
}

.work-panel__table th button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-cyan);
  font-size: 0.74rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.work-panel__table tr {
  cursor: pointer;
}

.work-panel__spacer,
.work-panel__spacer td {
  padding: 0;
  border: 0;
  pointer-events: none;
}

.work-panel__table tbody tr:hover,
.work-panel__table tbody tr.selected {
  background: rgba(88, 249, 255, 0.07);
}

.work-panel__table td:first-child {
  color: var(--accent-amber);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.work-panel__detail {
  max-height: 760px;
  overflow-y: auto;
}

.work-panel__empty {
  min-height: 360px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  text-align: center;
}

.work-panel__empty span {
  color: var(--accent-cyan);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.work-panel__empty strong {
  color: var(--text-primary);
  font-size: 1.4rem;
}

.work-panel__empty p {
  max-width: 36ch;
  color: var(--text-muted);
}

@media (max-width: 1120px) {
  .work-panel__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .work-panel__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
