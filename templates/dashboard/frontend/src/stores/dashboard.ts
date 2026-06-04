import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { api } from '@/api/client'
import {
  bootstrapQueryKeys,
  dashboardQueryKeys,
  invalidateDashboardQueries,
  refetchQueries,
} from '@/api/query'
import type {
  ActivityEvent,
  DagData,
  GanttRow,
  MetricsProviderPayload,
  ExperimentDetailResponse,
  ExperimentListResponse,
  ExperimentSummary,
  ObserveSnapshot,
  OverviewSummary,
  PluginSummary,
  ProgressData,
  ResearchConfig,
  SystemStatus,
  ToolPlugin,
  TreeDirection,
  TreeModule,
  WorkItem,
  WorkbenchTab,
} from '@/types'

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dataOr<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback
}

export const useDashboardStore = defineStore('dashboard', () => {
  const queryClient = useQueryClient()

  const activeTab = ref<WorkbenchTab>('experiments')
  const selectedWorkItemId = ref<string | null>(null)
  const selectedExperimentId = ref<string | null>(null)
  const selectedModuleId = ref<string | null>(null)
  const sseConnected = ref(false)
  const sseCursor = ref<string | null>(null)
  const sseError = ref<string | null>(null)

  const filters = reactive({
    status: '',
    module: '',
    direction: '',
    search: '',
  })

  const configQuery = useQuery({
    queryKey: dashboardQueryKeys.config,
    queryFn: api.getConfig,
    staleTime: 10_000,
  })
  const treeQuery = useQuery({
    queryKey: dashboardQueryKeys.tree,
    queryFn: api.getTree,
    staleTime: 10_000,
  })
  const progressQuery = useQuery({
    queryKey: dashboardQueryKeys.progress,
    queryFn: api.getProgress,
    staleTime: 5_000,
  })
  const overviewQuery = useQuery({
    queryKey: dashboardQueryKeys.overviewSummary,
    queryFn: api.getOverviewSummary,
    staleTime: 5_000,
  })
  const systemQuery = useQuery({
    queryKey: dashboardQueryKeys.systemStatus,
    queryFn: api.getSystemStatus,
    staleTime: 10_000,
  })
  const observeQuery = useQuery({
    queryKey: dashboardQueryKeys.observe,
    queryFn: api.getObserve,
    staleTime: 5_000,
  })
  const experimentsQuery = useQuery({
    queryKey: dashboardQueryKeys.experiments,
    queryFn: () => api.getExperiments({ limit: 250 }),
    staleTime: 5_000,
  })
  const pluginsQuery = useQuery({
    queryKey: dashboardQueryKeys.plugins,
    queryFn: api.getPlugins,
    staleTime: 10_000,
  })
  const toolsQuery = useQuery({
    queryKey: dashboardQueryKeys.tools,
    queryFn: api.getTools,
    staleTime: 10_000,
  })
  const metricsQuery = useQuery({
    queryKey: dashboardQueryKeys.metrics,
    queryFn: api.getMetrics,
    staleTime: 5_000,
  })
  const effectiveSelectedExperimentId = computed(
    () =>
      selectedExperimentId.value ??
      experimentsQuery.data.value?.selected_experiment_id ??
      experimentsQuery.data.value?.effective_experiment_id ??
      experimentsQuery.data.value?.experiments[0]?.experiment_id ??
      null,
  )
  const workItemsQuery = useQuery({
    queryKey: dashboardQueryKeys.workItems,
    queryFn: () => api.getWorkItems({ limit: 1000 }),
    staleTime: 5_000,
  })
  const dagQuery = useQuery({
    queryKey: dashboardQueryKeys.dag,
    queryFn: api.getDag,
    staleTime: 10_000,
  })
  const ganttQuery = useQuery({
    queryKey: dashboardQueryKeys.gantt,
    queryFn: api.getGantt,
    staleTime: 10_000,
  })
  const activityQuery = useQuery({
    queryKey: dashboardQueryKeys.activity,
    queryFn: () => api.getActivity(50),
    staleTime: 10_000,
  })
  const selectedWorkItemQuery = useQuery({
    queryKey: computed(() => dashboardQueryKeys.workItem(selectedWorkItemId.value ?? 'none')),
    queryFn: () => api.getWorkItem(selectedWorkItemId.value ?? ''),
    enabled: computed(() => Boolean(selectedWorkItemId.value)),
    staleTime: 5_000,
  })
  const selectedExperimentQuery = useQuery({
    queryKey: computed(() => dashboardQueryKeys.experiment(effectiveSelectedExperimentId.value ?? 'none')),
    queryFn: () => api.getExperiment(effectiveSelectedExperimentId.value ?? ''),
    enabled: computed(() => Boolean(effectiveSelectedExperimentId.value)),
    staleTime: 5_000,
  })

  const bootstrapQueries = [
    configQuery,
    treeQuery,
    progressQuery,
    overviewQuery,
    systemQuery,
    observeQuery,
    experimentsQuery,
    pluginsQuery,
    toolsQuery,
    metricsQuery,
    workItemsQuery,
    dagQuery,
    ganttQuery,
  ]

  const config = computed<ResearchConfig | null>(() => configQuery.data.value ?? null)
  const tree = computed<TreeDirection[]>(() => dataOr(treeQuery.data.value, []))
  const progress = computed<ProgressData | null>(() => progressQuery.data.value ?? null)
  const overviewSummary = computed<OverviewSummary | null>(() => overviewQuery.data.value ?? null)
  const systemStatus = computed<SystemStatus | null>(() => systemQuery.data.value ?? null)
  const observeSnapshot = computed<ObserveSnapshot | null>(() => observeQuery.data.value ?? null)
  const experiments = computed<ExperimentListResponse | null>(() => experimentsQuery.data.value ?? null)
  const pluginSummary = computed<PluginSummary | null>(() => pluginsQuery.data.value ?? null)
  const toolPlugins = computed<ToolPlugin[]>(() => dataOr(toolsQuery.data.value?.tools, []))
  const metricsProvider = computed<MetricsProviderPayload | null>(() => metricsQuery.data.value ?? null)
  const workItems = computed<WorkItem[]>(() => dataOr(workItemsQuery.data.value?.work_items, []))
  const dag = computed<DagData | null>(() => dagQuery.data.value ?? null)
  const gantt = computed<GanttRow[]>(() => dataOr(ganttQuery.data.value, []))
  const activity = computed<ActivityEvent[]>(() => dataOr(activityQuery.data.value, []))
  const selectedExperiment = computed<ExperimentSummary | null>(() => {
    const selectedId = effectiveSelectedExperimentId.value
    if (!selectedId) return null
    return (
      selectedExperimentQuery.data.value?.experiment ??
      experiments.value?.experiments.find((item) => item.experiment_id === selectedId) ??
      null
    )
  })
  const selectedExperimentDetail = computed<ExperimentDetailResponse | null>(() => selectedExperimentQuery.data.value ?? null)

  const selectedWorkItem = computed<WorkItem | null>(() => {
    if (!selectedWorkItemId.value) return null
    return (
      selectedWorkItemQuery.data.value ??
      workItems.value.find((item) => item.id === selectedWorkItemId.value) ??
      null
    )
  })

  const modules = computed<TreeModule[]>(() =>
    tree.value.flatMap((direction) => direction.modules),
  )

  const selectedModule = computed<TreeModule | null>(() =>
    modules.value.find((item) => item.id === selectedModuleId.value) ?? null,
  )

  const filteredTree = computed<TreeDirection[]>(() => {
    const query = filters.search.trim().toLowerCase()
    return tree.value
      .map((direction) => {
        if (filters.direction && direction.direction !== filters.direction) {
          return null
        }
        const nextModules = direction.modules
          .map((module) => {
            if (filters.module && module.id !== filters.module) {
              return null
            }
            const nextTasks = module.work_items.filter((task) => {
              const searchPool = [
                task.id,
                task.title,
                module.id,
                module.name,
                direction.label,
                direction.direction,
              ]
                .join(' ')
                .toLowerCase()
              const matchesStatus = !filters.status || task.status === filters.status
              const matchesSearch = !query || searchPool.includes(query)
              return matchesStatus && matchesSearch
            })
            if (!nextTasks.length && !query && !filters.status) {
              return module
            }
            if (!nextTasks.length) {
              return null
            }
            return {
              ...module,
              work_item_count: nextTasks.length,
              work_items: nextTasks,
            }
          })
          .filter((module): module is TreeModule => Boolean(module))
        if (!nextModules.length) {
          return null
        }
        return {
          ...direction,
          module_count: nextModules.length,
          modules: nextModules,
        }
      })
      .filter((direction): direction is TreeDirection => Boolean(direction))
  })

  const loading = computed(() => ({
    bootstrap: bootstrapQueries.some((query) => query.isFetching.value),
    detail: selectedWorkItemQuery.isFetching.value,
    dag: dagQuery.isFetching.value,
    gantt: ganttQuery.isFetching.value,
    activity: activityQuery.isFetching.value,
    system: systemQuery.isFetching.value,
  }))

  const lastUpdatedAt = computed(() => {
    const stamp = Math.max(0, ...bootstrapQueries.map((query) => query.dataUpdatedAt.value))
    return stamp > 0 ? new Date(stamp).toISOString() : null
  })

  const lastError = computed(() => {
    const first = [
      ['config', configQuery.error.value],
      ['tree', treeQuery.error.value],
      ['progress', progressQuery.error.value],
      ['overview', overviewQuery.error.value],
      ['system', systemQuery.error.value],
      ['observe', observeQuery.error.value],
      ['experiments', experimentsQuery.error.value],
      ['plugins', pluginsQuery.error.value],
      ['tools', toolsQuery.error.value],
      ['metrics', metricsQuery.error.value],
      ['work items', workItemsQuery.error.value],
      ['dag', dagQuery.error.value],
      ['gantt', ganttQuery.error.value],
      ['activity', activityQuery.error.value],
      ['work item detail', selectedWorkItemQuery.error.value],
    ].find(([, error]) => Boolean(error))
    if (first) return `${first[0]}: ${stringifyError(first[1])}`
    return sseError.value ? `sse: ${sseError.value}` : null
  })

  async function fetchBootstrap() {
    await refetchQueries(bootstrapQueries)
  }

  async function fetchDag() {
    await dagQuery.refetch()
  }

  async function fetchGantt() {
    await ganttQuery.refetch()
  }

  async function fetchActivity() {
    await activityQuery.refetch()
  }

  async function fetchSystemStatus() {
    await systemQuery.refetch()
  }

  async function loadTabData(tab: WorkbenchTab) {
    if (tab === 'work') {
      await refetchQueries([dagQuery, workItemsQuery])
    } else if (tab === 'runs') {
      await refetchQueries([ganttQuery, activityQuery, observeQuery, progressQuery])
    } else if (tab === 'metrics') {
      await refetchQueries([metricsQuery, observeQuery])
    } else if (tab === 'experiments') {
      await refetchQueries([experimentsQuery, metricsQuery, observeQuery])
    } else if (tab === 'extensions') {
      await refetchQueries([pluginsQuery, toolsQuery, activityQuery])
    } else if (tab === 'system') {
      await refetchQueries([systemQuery, observeQuery, overviewQuery])
    }
  }

  async function refreshForActiveTab() {
    await invalidateDashboardQueries(queryClient, bootstrapQueryKeys)
    await loadTabData(activeTab.value)
  }

  async function selectWorkItem(workId: string) {
    selectedWorkItemId.value = workId
    selectedModuleId.value = null
    activeTab.value = 'work'
    await queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.workItem(workId),
      queryFn: () => api.getWorkItem(workId),
      staleTime: 5_000,
    })
  }

  function selectModule(moduleId: string) {
    selectedModuleId.value = moduleId
    selectedWorkItemId.value = null
    activeTab.value = 'work'
  }

  function clearSelection() {
    selectedWorkItemId.value = null
    selectedModuleId.value = null
  }

  async function selectExperiment(experimentId: string) {
    selectedExperimentId.value = experimentId
    activeTab.value = 'experiments'
    await api.selectExperiment(experimentId)
    await refetchQueries([experimentsQuery, metricsQuery, observeQuery, selectedExperimentQuery])
  }

  async function archiveExperiment(experimentId: string) {
    await api.updateExperiment(experimentId, { status: 'archived' })
    await refetchQueries([experimentsQuery, metricsQuery, observeQuery])
  }

  function setActiveTab(tab: WorkbenchTab) {
    activeTab.value = tab
  }

  function markSseConnected(cursor?: string | null) {
    sseConnected.value = true
    sseError.value = null
    if (cursor) sseCursor.value = cursor
  }

  function markSseDisconnected(error?: string) {
    sseConnected.value = false
    sseError.value = error ?? null
  }

  return {
    activity,
    activeTab,
    config,
    dag,
    experiments,
    filteredTree,
    filters,
    gantt,
    lastError,
    lastUpdatedAt,
    loading,
    modules,
    overviewSummary,
    observeSnapshot,
    pluginSummary,
    progress,
    selectedExperiment,
    selectedExperimentDetail,
    effectiveSelectedExperimentId,
    selectedExperimentId,
    selectedModule,
    selectedModuleId,
    selectedWorkItem,
    selectedWorkItemId,
    sseConnected,
    sseCursor,
    systemStatus,
    toolPlugins,
    metricsProvider,
    tree,
    workItems,
    clearSelection,
    fetchActivity,
    fetchBootstrap,
    fetchDag,
    fetchGantt,
    fetchSystemStatus,
    loadTabData,
    markSseConnected,
    markSseDisconnected,
    refreshForActiveTab,
    selectModule,
    selectExperiment,
    archiveExperiment,
    selectWorkItem,
    setActiveTab,
  }
})
