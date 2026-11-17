// Tab discovery with portable navigation addresses.
import type { ViewInfo, WorkspaceTabId } from '@/lib/types'
import { viewTabId } from '@/lib/workspace-tabs'

// `moi tabs` lists all destinations, regardless of which tabs are open.
export type TabRow = {
  id: WorkspaceTabId
  title: string
  href: string
}

// The always-present tabs, titled like the tab bar renders them.
const STATIC_TABS: { id: WorkspaceTabId; title: string }[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'scratchpad', title: 'Scratchpad' }
]

// The `moi tabs` listing: static tabs plus every compiled or pending view.
export function assembleTabRows(views: ViewInfo[]): TabRow[] {
  return [
    ...STATIC_TABS,
    ...views.map(view => ({ id: viewTabId(view.id), title: view.title || view.id }))
  ].map(row => ({ ...row, href: `moi:/${row.id}` }))
}

// CLI navigation checks the server's current built-view list before asking a
// browser to move. The browser repeats the availability check in case its view
// list is stale in either direction.
export function assertNavigableTab(tab: WorkspaceTabId, views: ViewInfo[]): void {
  const rows = assembleTabRows(views)
  if (rows.some(row => row.id === tab)) return
  throw new Error(
    `Unknown destination "moi:/${tab}". Valid addresses: ${rows.map(row => row.href).join(', ')}`
  )
}
