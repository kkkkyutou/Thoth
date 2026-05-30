import type {
  ActivityEvent,
  DagData,
  GanttRow,
  OverviewSummary,
  ProgressData,
  ResearchConfig,
  RunDetail,
  RunEventPage,
  RunWorkerLogs,
  RunSummary,
  SystemStatus,
  TimelineItem,
  WorkItem,
  WorkItemFilters,
  WorkItemListResponse,
  WorkItemRunsResponse,
  Milestone,
  MetricsProviderPayload,
  ObserveSnapshot,
  PluginSummary,
  TodoProject,
  ToolPlugin,
  TreeDirection,
} from '@/types'

const BASE = '/api'
const ACTION_TOKEN_HEADER = 'X-Thoth-Action-Token'

let actionTokenPromise: Promise<string> | null = null

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || body.error || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function actionToken(): Promise<string> {
  if (!actionTokenPromise) {
    actionTokenPromise = request<{ token: string }>('/action-token').then((payload) => payload.token)
  }
  return actionTokenPromise
}

async function actionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await actionToken()
  return request<T>(path, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      [ACTION_TOKEN_HEADER]: token,
    },
  })
}

export const api = {
  getConfig: () => request<ResearchConfig>('/config'),
  getTree: () => request<TreeDirection[]>('/tree'),
  getProgress: () => request<ProgressData>('/progress'),
  getOverviewSummary: () => request<OverviewSummary>('/overview-summary'),
  getSystemStatus: () => request<SystemStatus>('/status'),
  getObserve: () => request<ObserveSnapshot>('/observe'),
  getPlugins: () => request<PluginSummary>('/plugins'),
  getTools: () => request<{ schema_version: number; tool_count: number; tools: ToolPlugin[] }>('/tools'),
  getMetrics: () => request<MetricsProviderPayload>('/metrics'),

  getWorkItems: (filters?: WorkItemFilters) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.module) params.set('module', filters.module)
    if (filters?.direction) params.set('direction', filters.direction)
    if (filters?.limit) params.set('limit', String(filters.limit))
    if (filters?.offset) params.set('offset', String(filters.offset))
    const query = params.toString()
    return request<WorkItemListResponse>(`/work-items${query ? `?${query}` : ''}`)
  },
  getWorkItem: (workId: string) => request<WorkItem>(`/work-items/${workId}`),
  getWorkItemActiveRun: (workId: string) =>
    request<RunSummary | null>(`/work-items/${workId}/active-run`),
  getWorkItemRuns: (workId: string) =>
    request<WorkItemRunsResponse>(`/work-items/${workId}/runs`),
  getRun: (runId: string) => request<RunDetail>(`/runs/${runId}`),
  getRunEvents: (runId: string, afterSeq?: number | null, limit = 100) => {
    const params = new URLSearchParams()
    if (afterSeq != null) params.set('after_seq', String(afterSeq))
    params.set('limit', String(limit))
    return request<RunEventPage>(`/runs/${runId}/events?${params.toString()}`)
  },
  getRunWorkerLogs: (runId: string, phase?: string | null, tail = 20000) => {
    const params = new URLSearchParams()
    if (phase) params.set('phase', phase)
    params.set('tail', String(tail))
    return request<RunWorkerLogs>(`/runs/${runId}/worker-logs?${params.toString()}`)
  },

  getDag: () => request<DagData>('/dag'),
  getTimeline: () => request<TimelineItem[]>('/timeline'),
  getGantt: () => request<GanttRow[]>('/gantt'),
  getMilestones: () => request<Milestone[]>('/milestones'),
  getActivity: (limit = 50) => request<ActivityEvent[]>(`/activity?limit=${limit}`),

  getTodo: () => request<TodoProject[]>('/todo'),
  addTodoProject: (name: string) =>
    actionRequest<{ id: number; name: string }>('/todo/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  addTodoTask: (projectId: number, description: string, dueDate?: string) =>
    actionRequest<{ id: number; project_id: number; description: string }>(
      '/todo/tasks',
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          description,
          due_date: dueDate ?? null,
        }),
      },
    ),
  updateTodoTask: (
    taskId: number,
    patch: { completed?: boolean; description?: string; due_date?: string },
  ) =>
    actionRequest<{ id: number; updated: boolean }>(`/todo/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  triggerValidate: () =>
    actionRequest<Record<string, unknown>>('/trigger/validate', { method: 'POST' }),
  triggerSync: () =>
    actionRequest<Record<string, unknown>>('/trigger/sync', { method: 'POST' }),
  triggerHealthCheck: () =>
    actionRequest<Record<string, unknown>>('/trigger/health-check', {
      method: 'POST',
    }),
}
