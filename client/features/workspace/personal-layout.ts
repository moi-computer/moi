import { useCallback } from 'react'
import { jsonRequest, requestJson } from '@/client/api/http'
import { createDefaultPersonalLayout, normalizeWorkspaceTabs } from '@/lib/workspace-layout'
import type { PersonalWorkspaceLayout, WorkspaceState, WorkspaceTabsState } from '@/lib/types'
import { useWorkspaceLayoutCtx } from './workspace-layout-context'
import { useWorkspaceState, useWorkspaceStateWrite } from './workspace-state'

const defaults = createDefaultPersonalLayout()

export function usePersonalLayout() {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const query = useWorkspaceState(workspaceId, state => state.layout ?? defaults)
  const { mutate } = useWorkspaceStateWrite<Partial<PersonalWorkspaceLayout>>(workspaceId, {
    request: patch =>
      requestJson<WorkspaceState>(
        `/api/workspaces/${workspaceId}/state/layout`,
        jsonRequest('PATCH', patch)
      ),
    optimistic: (state, patch) => {
      state.layout = { ...(state.layout ?? defaults), ...patch }
    },
    errorTitle: 'Couldn’t save workspace preferences'
  })
  return [query.data ?? defaults, mutate] as const
}

export function useWorkspaceTabs() {
  const [layout, save] = usePersonalLayout()
  const setTabs = useCallback(
    (tabs: WorkspaceTabsState) => {
      const next = normalizeWorkspaceTabs(tabs)
      save({ tabs: next })
      return next
    },
    [save]
  )
  return [layout.tabs, setTabs] as const
}
