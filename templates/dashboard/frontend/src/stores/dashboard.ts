import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api/client'
import type {
  ActivityEvent,
  DagData,
  GanttRow,
  MetricsProviderPayload,
  ObserveSnapshot,
  OverviewSummary,
  PluginSummary,
  ProgressData,
  ResearchConfig,
  SystemStatus,
  ToolPlugin,
  WorkItem,
  TreeDirection,
  TreeModule,
  WorkbenchTab,
} from '@/types'

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useDashboardStore = defineStore('dashboard', () => {
  const config = ref<ResearchConfig | null>(null)
  const tree = ref<TreeDirection[]>([])
  const progress = ref<ProgressData | null>(null)
  const overviewSummary = ref<OverviewSummary | null>(null)
  const dag = ref<DagData | null>(null)
  const gantt = ref<GanttRow[]>([])
  const activity = ref<ActivityEvent[]>([])
  const systemStatus = ref<SystemStatus | null>(null)
  const observeSnapshot = ref<ObserveSnapshot | null>(null)
  const pluginSummary = ref<PluginSummary | null>(null)
  const toolPlugins = ref<ToolPlugin[]>([])
  const metricsProvider = ref<MetricsProviderPayload | null>(null)
  const workItems = ref<WorkItem[]>([])

  const selectedWorkItem = ref<WorkItem | null>(null)
  const selectedModuleId = ref<string | null>(null)
  const activeTab = ref<WorkbenchTab>('overview')
  const lastUpdatedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  const loading = reactive({
    bootstrap: false,
    detail: false,
    dag: false,
    gantt: false,
    activity: false,
    system: false,
  })

  const filters = reactive({
    status: '',
    module: '',
    direction: '',
    search: '',
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

  async function fetchBootstrap() {
    loading.bootstrap = true
    const results = await Promise.allSettled([
      api.getConfig(),
      api.getTree(),
      api.getProgress(),
      api.getOverviewSummary(),
      api.getSystemStatus(),
      api.getObserve(),
      api.getPlugins(),
      api.getTools(),
      api.getMetrics(),
      api.getWorkItems({ limit: 1000 }),
      api.getDag(),
      api.getGantt(),
    ])
    if (results[0].status === 'fulfilled') config.value = results[0].value
    else lastError.value = `config: ${stringifyError(results[0].reason)}`

    if (results[1].status === 'fulfilled') tree.value = results[1].value
    else lastError.value = `tree: ${stringifyError(results[1].reason)}`

    if (results[2].status === 'fulfilled') progress.value = results[2].value
    else lastError.value = `progress: ${stringifyError(results[2].reason)}`

    if (results[3].status === 'fulfilled') overviewSummary.value = results[3].value
    else lastError.value = `overview: ${stringifyError(results[3].reason)}`

    if (results[4].status === 'fulfilled') systemStatus.value = results[4].value
    else lastError.value = `system: ${stringifyError(results[4].reason)}`

    if (results[5].status === 'fulfilled') observeSnapshot.value = results[5].value
    else lastError.value = `observe: ${stringifyError(results[5].reason)}`

    if (results[6].status === 'fulfilled') pluginSummary.value = results[6].value
    else lastError.value = `plugins: ${stringifyError(results[6].reason)}`

    if (results[7].status === 'fulfilled') toolPlugins.value = results[7].value.tools
    else lastError.value = `tools: ${stringifyError(results[7].reason)}`

    if (results[8].status === 'fulfilled') metricsProvider.value = results[8].value
    else lastError.value = `metrics: ${stringifyError(results[8].reason)}`

    if (results[9].status === 'fulfilled') workItems.value = results[9].value.work_items
    else lastError.value = `work items: ${stringifyError(results[9].reason)}`

    if (results[10].status === 'fulfilled') dag.value = results[10].value
    else lastError.value = `dag: ${stringifyError(results[10].reason)}`

    if (results[11].status === 'fulfilled') gantt.value = results[11].value
    else lastError.value = `gantt: ${stringifyError(results[11].reason)}`

    lastUpdatedAt.value = new Date().toISOString()
    loading.bootstrap = false
  }

  async function fetchDag() {
    loading.dag = true
    try {
      dag.value = await api.getDag()
    } catch (error) {
      lastError.value = `dag: ${stringifyError(error)}`
    } finally {
      loading.dag = false
    }
  }

  async function fetchGantt() {
    loading.gantt = true
    try {
      gantt.value = await api.getGantt()
    } catch (error) {
      lastError.value = `gantt: ${stringifyError(error)}`
    } finally {
      loading.gantt = false
    }
  }

  async function fetchActivity() {
    loading.activity = true
    try {
      activity.value = await api.getActivity()
    } catch (error) {
      lastError.value = `activity: ${stringifyError(error)}`
    } finally {
      loading.activity = false
    }
  }

  async function fetchSystemStatus() {
    loading.system = true
    try {
      systemStatus.value = await api.getSystemStatus()
    } catch (error) {
      lastError.value = `system: ${stringifyError(error)}`
    } finally {
      loading.system = false
    }
  }

  async function loadTabData(tab: WorkbenchTab) {
    if (tab === 'dag') {
      await fetchDag()
    } else if (tab === 'gantt') {
      await fetchGantt()
    } else if (tab === 'activity') {
      await fetchActivity()
    } else if (tab === 'system') {
      await fetchSystemStatus()
    }
  }

  async function refreshForActiveTab() {
    await fetchBootstrap()
    await loadTabData(activeTab.value)
  }

  async function selectWorkItem(workId: string) {
    loading.detail = true
    try {
      selectedWorkItem.value = await api.getWorkItem(workId)
      selectedModuleId.value = null
      activeTab.value = 'detail'
    } catch (error) {
      lastError.value = `work item ${workId}: ${stringifyError(error)}`
    } finally {
      loading.detail = false
    }
  }

  function selectModule(moduleId: string) {
    selectedModuleId.value = moduleId
    selectedWorkItem.value = null
    activeTab.value = 'detail'
  }

  function clearSelection() {
    selectedWorkItem.value = null
    selectedModuleId.value = null
  }

  function setActiveTab(tab: WorkbenchTab) {
    activeTab.value = tab
  }

  return {
    activity,
    activeTab,
    config,
    dag,
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
    selectedModule,
    selectedModuleId,
    selectedWorkItem,
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
    refreshForActiveTab,
    selectModule,
    selectWorkItem,
    setActiveTab,
  }
})
