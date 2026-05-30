import type { QueryClient, QueryKey } from '@tanstack/vue-query'
import { dashboardQueryKeys } from './query'

export interface DashboardDeltaEvent {
  type?: string
  path?: string
  size?: number
  mtime_ns?: number
}

export interface DashboardDeltaPayload {
  schema_version?: number
  cursor?: string
  changed?: boolean
  fingerprint_changed?: boolean
  events?: DashboardDeltaEvent[]
}

function uniqueKeys(keys: QueryKey[]): QueryKey[] {
  const seen = new Set<string>()
  const result: QueryKey[] = []
  for (const key of keys) {
    const signature = JSON.stringify(key)
    if (seen.has(signature)) continue
    seen.add(signature)
    result.push(key)
  }
  return result
}

export function queryKeysForChangedPath(path: string): QueryKey[] {
  if (path.startsWith('.thoth/runs/')) {
    return [
      dashboardQueryKeys.observe,
      dashboardQueryKeys.progress,
      dashboardQueryKeys.overviewSummary,
      dashboardQueryKeys.systemStatus,
      dashboardQueryKeys.workItems,
      dashboardQueryKeys.workItemPrefix,
      dashboardQueryKeys.gantt,
      dashboardQueryKeys.activity,
      dashboardQueryKeys.runPrefix,
    ]
  }
  if (path.startsWith('.thoth/objects/')) {
    return [
      dashboardQueryKeys.config,
      dashboardQueryKeys.tree,
      dashboardQueryKeys.progress,
      dashboardQueryKeys.overviewSummary,
      dashboardQueryKeys.observe,
      dashboardQueryKeys.workItems,
      dashboardQueryKeys.workItemPrefix,
      dashboardQueryKeys.dag,
      dashboardQueryKeys.gantt,
      dashboardQueryKeys.activity,
    ]
  }
  if (path.startsWith('.thoth/extensions/')) {
    return [
      dashboardQueryKeys.observe,
      dashboardQueryKeys.plugins,
      dashboardQueryKeys.tools,
      dashboardQueryKeys.metrics,
      dashboardQueryKeys.systemStatus,
    ]
  }
  return [dashboardQueryKeys.root]
}

export function queryKeysForDelta(payload: DashboardDeltaPayload): QueryKey[] {
  if (!payload.changed) return []
  const events = payload.events ?? []
  if (!events.length || payload.fingerprint_changed) {
    return [dashboardQueryKeys.root]
  }
  return uniqueKeys(events.flatMap((event) => queryKeysForChangedPath(event.path ?? '')))
}

export function applyDashboardDelta(queryClient: QueryClient, payload: DashboardDeltaPayload): void {
  for (const queryKey of queryKeysForDelta(payload)) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
