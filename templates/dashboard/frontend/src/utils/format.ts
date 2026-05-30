import type { RunSummary } from '@/types'

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function formatTime(value?: string | number | null): string {
  if (value == null || value === '') return 'N/A'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function clampPercent(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, numeric))
}

export function uniqueRuns(runs: Array<RunSummary | null | undefined>): RunSummary[] {
  const seen = new Set<string>()
  const result: RunSummary[] = []
  for (const run of runs) {
    if (!run?.run_id || seen.has(run.run_id)) continue
    seen.add(run.run_id)
    result.push(run)
  }
  return result.sort((left, right) => {
    const ltime = Date.parse(left.last_updated_at ?? left.started_at ?? left.created_at ?? '')
    const rtime = Date.parse(right.last_updated_at ?? right.started_at ?? right.created_at ?? '')
    return (Number.isFinite(rtime) ? rtime : 0) - (Number.isFinite(ltime) ? ltime : 0)
  })
}

export function isRunActive(run?: RunSummary | null): boolean {
  return !!run && ['queued', 'running', 'waiting_input', 'stopping', 'paused'].includes(run.status)
}

export function shortText(value: unknown, fallback = 'N/A', max = 120): string {
  const text = value == null || value === '' ? fallback : String(value)
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}
