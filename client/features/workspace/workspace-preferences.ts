import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { jsonRequest, requestJson } from '@/client/api/http'
import { useUiStore, defaultWorkspaceUi, type WorkspaceUi } from '@/client/store/ui'
import { useWorkspaceSessionStore } from '@/client/store/workspace-session'
import { normalizeOpenTabs } from '@/lib/workspace-layout'
import type { ViewInfo, WorkspaceState, WorkspaceTabId, WorkspaceTabsState } from '@/lib/types'
import { useWorkspaceLayoutCtx } from './workspace-layout-context'
import {
  getCachedWorkspaceState,
  useWorkspaceState,
  useWorkspaceStateWrite
} from './workspace-state'
import { tabAvailable } from './tab-resolution'
import { viewTabId } from '@/lib/workspace-tabs'

// Per-browser preferences for one workspace, local or remote. See client/store/ui.ts.
export function useWorkspaceUi() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const saved = useUiStore(state => state.workspaces[workspaceId])
  // Entries saved before a field existed fall back to its default.
  const ui = useMemo(() => ({ ...defaultWorkspaceUi, ...saved }), [saved])
  const setWorkspaceUi = useUiStore(state => state.setWorkspaceUi)
  const save = useCallback(
    (patch: Partial<WorkspaceUi>) => setWorkspaceUi(workspaceId, patch),
    [workspaceId, setWorkspaceUi]
  )
  return [ui, save] as const
}

export function useFloatingChatOpen() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const open = useWorkspaceSessionStore(state => state.workspaces[workspaceId]?.chatOpen ?? false)
  const save = useWorkspaceSessionStore(state => state.setWorkspaceSession)
  const setOpen = useCallback(
    (chatOpen: boolean) => save(workspaceId, { chatOpen }),
    [workspaceId, save]
  )
  return [open, setOpen] as const
}

function sameTabs(a: WorkspaceTabId[] | undefined, b: WorkspaceTabId[]) {
  return a?.length === b.length && a.every((tab, index) => tab === b[index])
}

// Requires loaded personal state and views.
export function useWorkspaceTabs(views: ViewInfo[]) {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const queryClient = useQueryClient()
  const { data } = useWorkspaceState(workspaceId)
  const active = useWorkspaceSessionStore(
    state => state.workspaces[workspaceId]?.activeTab ?? 'overview'
  )
  const saveSession = useWorkspaceSessionStore(state => state.setWorkspaceSession)
  const setActiveTab = useCallback(
    (activeTab: WorkspaceTabId) => saveSession(workspaceId, { activeTab }),
    [workspaceId, saveSession]
  )
  const { mutate } = useWorkspaceStateWrite<WorkspaceTabId[]>(workspaceId, {
    request: openTabs =>
      requestJson<WorkspaceState>(
        `/api/workspaces/${workspaceId}/state/tabs`,
        jsonRequest('PUT', { openTabs })
      ),
    optimistic: (draft, openTabs) => {
      draft.openTabs = openTabs
    },
    errorTitle: 'Couldn’t save workspace tabs'
  })
  // Deleted views leave the saved list on the next tab change.
  const open = useMemo(() => {
    const all: WorkspaceTabId[] = ['scratchpad', ...views.map(view => viewTabId(view.id))]
    return [
      'overview',
      ...normalizeOpenTabs(data?.openTabs ?? all).filter(tab => tabAvailable(tab, views))
    ] satisfies WorkspaceTabId[]
  }, [data?.openTabs, views])
  const tabs = useMemo(() => ({ open, active }), [open, active])

  const setTabs = useCallback(
    (tabs: WorkspaceTabsState) => {
      const openTabs = normalizeOpenTabs(tabs.open)
      setActiveTab(tabs.active)
      if (!sameTabs(getCachedWorkspaceState(queryClient, workspaceId)?.openTabs, openTabs))
        mutate(openTabs)
      return tabs
    },
    [workspaceId, setActiveTab, queryClient, mutate]
  )
  return [tabs, setTabs, setActiveTab] as const
}
