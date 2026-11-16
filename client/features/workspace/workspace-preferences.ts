import { useCallback, useMemo } from 'react'
import { useUiStore, defaultWorkspaceUi, type WorkspaceUi } from '@/client/store/ui'
import { normalizeWorkspaceTabs } from '@/lib/workspace-layout'
import type { WorkspaceTabsState } from '@/lib/types'
import { useWorkspaceLayoutCtx } from './workspace-layout-context'

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

export function useWorkspaceTabs() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const tabs = useUiStore(state => state.workspaces[workspaceId]?.tabs ?? defaultWorkspaceUi.tabs)
  const setWorkspaceUi = useUiStore(state => state.setWorkspaceUi)
  const setTabs = useCallback(
    (tabs: WorkspaceTabsState) => {
      const next = normalizeWorkspaceTabs(tabs)
      setWorkspaceUi(workspaceId, { tabs: next })
      return next
    },
    [workspaceId, setWorkspaceUi]
  )
  return [tabs, setTabs] as const
}
