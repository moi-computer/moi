import { useUiStore, defaultWorkspaceUi, type WorkspaceUi } from '@/client/store/ui'
import { useCallback } from 'react'
import { jsonRequest, requestJson } from '@/client/api/http'
import { createDefaultWorkspaceTabs, normalizeWorkspaceTabs } from '@/lib/workspace-layout'
import type { WorkspaceState, WorkspaceTabsState } from '@/lib/types'
import { useWorkspaceLayoutCtx } from './workspace-layout-context'
import { useWorkspaceState, useWorkspaceStateWrite } from './workspace-state'

const defaultTabs = createDefaultWorkspaceTabs()

export function useWorkspaceTabs() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const query = useWorkspaceState(workspaceId, state => state.tabs ?? defaultTabs)
  const { mutate } = useWorkspaceStateWrite<WorkspaceTabsState>(workspaceId, {
    request: tabs =>
      requestJson<WorkspaceState>(
        `/api/workspaces/${workspaceId}/state/tabs`,
        jsonRequest('PATCH', tabs)
      ),
    optimistic: (state, tabs) => {
      state.tabs = tabs
    },
    errorTitle: 'Couldn’t save workspace tabs'
  })
  const setTabs = useCallback(
    (tabs: WorkspaceTabsState) => {
      const next = normalizeWorkspaceTabs(tabs)
      mutate(next)
      return next
    },
    [mutate]
  )
  return [query.data ?? defaultTabs, setTabs] as const
}

export function useWorkspaceUi() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const layout = useUiStore(state => state.workspaces[workspaceId] ?? defaultWorkspaceUi)
  const setWorkspaceUi = useUiStore(state => state.setWorkspaceUi)
  const save = useCallback(
    (patch: Partial<WorkspaceUi>) => setWorkspaceUi(workspaceId, patch),
    [workspaceId, setWorkspaceUi]
  )
  return [layout, save] as const
}
