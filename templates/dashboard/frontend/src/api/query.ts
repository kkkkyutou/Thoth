import type { QueryClient, QueryObserverResult } from '@tanstack/vue-query'

export const dashboardQueryKeys = {
  root: ['dashboard'] as const,
  config: ['dashboard', 'config'] as const,
  tree: ['dashboard', 'tree'] as const,
  progress: ['dashboard', 'progress'] as const,
  overviewSummary: ['dashboard', 'overview-summary'] as const,
  systemStatus: ['dashboard', 'system-status'] as const,
  observe: ['dashboard', 'observe'] as const,
  plugins: ['dashboard', 'plugins'] as const,
  tools: ['dashboard', 'tools'] as const,
  metrics: ['dashboard', 'metrics'] as const,
  workItems: ['dashboard', 'work-items'] as const,
  workItemPrefix: ['dashboard', 'work-item'] as const,
  workItem: (workId: string) => ['dashboard', 'work-item', workId] as const,
  dag: ['dashboard', 'dag'] as const,
  gantt: ['dashboard', 'gantt'] as const,
  activity: ['dashboard', 'activity'] as const,
  runPrefix: ['dashboard', 'run'] as const,
}

export const bootstrapQueryKeys = [
  dashboardQueryKeys.config,
  dashboardQueryKeys.tree,
  dashboardQueryKeys.progress,
  dashboardQueryKeys.overviewSummary,
  dashboardQueryKeys.systemStatus,
  dashboardQueryKeys.observe,
  dashboardQueryKeys.plugins,
  dashboardQueryKeys.tools,
  dashboardQueryKeys.metrics,
  dashboardQueryKeys.workItems,
  dashboardQueryKeys.dag,
  dashboardQueryKeys.gantt,
]

export type RefreshableQuery = {
  refetch: () => Promise<QueryObserverResult<unknown, Error>>
}

export async function refetchQueries(queries: RefreshableQuery[]): Promise<void> {
  await Promise.allSettled(queries.map((query) => query.refetch()))
}

export async function invalidateDashboardQueries(
  queryClient: QueryClient,
  queryKeys = bootstrapQueryKeys,
): Promise<void> {
  await Promise.allSettled(
    queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  )
}
