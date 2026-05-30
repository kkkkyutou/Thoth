import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { WorkbenchTab } from '@/types'

const WorkbenchView = () => import('@/views/WorkbenchView.vue')

interface RouteMetaShape {
  tab: WorkbenchTab
  section?: 'milestones' | 'overview'
}

const routes: Array<RouteRecordRaw & { meta: RouteMetaShape }> = [
  {
    path: '/',
    redirect: '/cockpit',
    meta: { tab: 'cockpit' },
  },
  {
    path: '/cockpit',
    name: 'cockpit',
    component: WorkbenchView,
    meta: { tab: 'cockpit', section: 'overview' },
  },
  {
    path: '/runs',
    name: 'runs',
    component: WorkbenchView,
    meta: { tab: 'runs' },
  },
  {
    path: '/work',
    name: 'work',
    component: WorkbenchView,
    meta: { tab: 'work' },
  },
  {
    path: '/metrics',
    name: 'metrics',
    component: WorkbenchView,
    meta: { tab: 'metrics' },
  },
  {
    path: '/system',
    name: 'system',
    component: WorkbenchView,
    meta: { tab: 'system' },
  },
  {
    path: '/plugins',
    name: 'plugins',
    component: WorkbenchView,
    meta: { tab: 'plugins' },
  },
  {
    path: '/overview',
    redirect: '/cockpit',
    meta: { tab: 'cockpit' },
  },
  {
    path: '/work-items',
    redirect: '/work',
    meta: { tab: 'work' },
  },
  {
    path: '/dag',
    redirect: '/work',
    meta: { tab: 'work' },
  },
  {
    path: '/timeline',
    redirect: '/runs',
    meta: { tab: 'runs' },
  },
  {
    path: '/todo',
    redirect: '/plugins',
    meta: { tab: 'plugins' },
  },
  {
    path: '/activity',
    redirect: '/runs',
    meta: { tab: 'runs' },
  },
  {
    path: '/milestones',
    redirect: '/cockpit',
    meta: { tab: 'cockpit', section: 'milestones' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
