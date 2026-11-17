import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useParams } from 'wouter'

import { jsonRequest, requestJson } from '@/client/api/http'
import { useWorkspaceId } from '@/client/features/workspace/workspace-context'
import {
  changeWorkspaceStateCache,
  getCachedWorkspaceState,
  renameSessionInState,
  useWorkspaceState,
  useWorkspaceStateWrite
} from '@/client/features/workspace/workspace-state'
import { useUiStore } from '@/client/store/ui'
import { composerDraftKey } from '@/lib/session-drafts'
import type { WorkspaceState, WorkspaceTabId } from '@/lib/types'
import { isWorkspaceTabId } from '@/lib/workspace-tabs'

type SetSelectedSession = (sessionId: string | null) => void

type SelectedSessionResult = readonly [
  sessionId: string | null | undefined,
  setSessionId: SetSelectedSession,
  selectSessionForTab: (sessionId: string, tabId: WorkspaceTabId) => Promise<void>
]

// PUT shows `sessionId` in the tab (only while it still shows `ifMatch`, when
// given); DELETE clears the tab if it still shows `sessionId`.
type SelectionWrite = {
  sessionId: string
  tabId: WorkspaceTabId
  show: boolean
  ifMatch?: string | null
}

// The personal pin takes precedence over the chat selected in this workspace tab.
export function selectedSessionForTab(
  state: WorkspaceState | undefined,
  tabId: WorkspaceTabId
): string | null | undefined {
  if (!state) return undefined
  if (state.pinnedSessionId) return state.pinnedSessionId
  return state.selected[tabId] ?? null
}

export function cachedSelectedSession(
  queryClient: QueryClient,
  workspaceId: string,
  tabId: WorkspaceTabId
) {
  return selectedSessionForTab(getCachedWorkspaceState(queryClient, workspaceId), tabId)
}

function applySelectionWrite(draft: WorkspaceState, input: SelectionWrite): void {
  if (input.show) draft.selected[input.tabId] = input.sessionId
  else if (draft.selected[input.tabId] === input.sessionId) delete draft.selected[input.tabId]
}

// The request that points `tabId` at `sessionId` (null: a new chat), or
// undefined when nothing needs saving.
function selectionChange(
  queryClient: QueryClient,
  workspaceId: string,
  sessionId: string | null,
  tabId: WorkspaceTabId
): SelectionWrite | undefined {
  const current = getCachedWorkspaceState(queryClient, workspaceId)?.selected[tabId] ?? null
  if (current === sessionId) return
  if (sessionId === null) return current ? { sessionId: current, tabId, show: false } : undefined
  return { sessionId, tabId, show: true, ifMatch: current }
}

// A harness replaced a temporary chat id with its real one.
export function renameSelectedSessionInCache(
  queryClient: QueryClient,
  workspaceId: string,
  from: string,
  to: string
): void {
  useUiStore
    .getState()
    .moveComposerDraft(composerDraftKey(workspaceId, from), composerDraftKey(workspaceId, to))
  changeWorkspaceStateCache(queryClient, workspaceId, draft =>
    renameSessionInState(draft, from, to)
  )
}

export function useCurrentTabId(): WorkspaceTabId {
  const tab = useParams()['*']
  return isWorkspaceTabId(tab) ? tab : 'overview'
}

function useSelectionWrite(workspaceId: string) {
  return useWorkspaceStateWrite<SelectionWrite>(workspaceId, {
    request: ({ sessionId, tabId, show, ifMatch }) =>
      requestJson<WorkspaceState>(
        `/api/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/selection`,
        jsonRequest(show ? 'PUT' : 'DELETE', show ? { tabId, ifMatch } : { tabId }),
        'Couldn’t save selected chat'
      ),
    optimistic: applySelectionWrite,
    errorTitle: 'Couldn’t save selected chat'
  })
}

export function useSelectedSession(explicitTabId?: WorkspaceTabId): SelectedSessionResult {
  const routeTabId = useCurrentTabId()
  const tabId = explicitTabId ?? routeTabId
  const workspaceId = useWorkspaceId()
  const queryClient = useQueryClient()
  const state = useWorkspaceState(workspaceId).data
  const { mutate: save, mutateAsync: saveAsync } = useSelectionWrite(workspaceId)

  const setSelectedSessionId = useCallback<SetSelectedSession>(
    sessionId => {
      // A pinned chat shows in every tab until it is unpinned.
      if (getCachedWorkspaceState(queryClient, workspaceId)?.pinnedSessionId) return
      const input = selectionChange(queryClient, workspaceId, sessionId, tabId)
      if (input) save(input)
    },
    [queryClient, save, workspaceId, tabId]
  )

  const selectSessionForTab = useCallback(
    async (sessionId: string, destination: WorkspaceTabId) => {
      const input = selectionChange(queryClient, workspaceId, sessionId, destination)
      if (!input) return
      const saved = await saveAsync(input)
      if (saved.selected[destination] !== sessionId) throw new Error('Couldn’t save selected chat')
    },
    [queryClient, saveAsync, workspaceId]
  )

  const selectedSessionId = selectedSessionForTab(state, tabId)
  return [selectedSessionId, setSelectedSessionId, selectSessionForTab]
}

export function usePinnedSession() {
  const workspaceId = useWorkspaceId()
  const queryClient = useQueryClient()
  const state = useWorkspaceState(workspaceId).data
  const { mutate, mutateAsync } = useWorkspaceStateWrite<{ sessionId: string; pinned: boolean }>(
    workspaceId,
    {
      request: ({ sessionId, pinned }) =>
        requestJson<WorkspaceState>(
          `/api/workspaces/${workspaceId}/sessions/${encodeURIComponent(sessionId)}/pin`,
          { method: pinned ? 'PUT' : 'DELETE' },
          pinned ? 'Couldn’t pin chat' : 'Couldn’t unpin chat'
        ),
      optimistic: (draft, { sessionId, pinned }) => {
        if (pinned) draft.pinnedSessionId = sessionId
        else if (draft.pinnedSessionId === sessionId) delete draft.pinnedSessionId
      },
      errorTitle: 'Couldn’t change the pinned chat'
    }
  )
  const pin = useCallback((sessionId: string) => mutate({ sessionId, pinned: true }), [mutate])
  const unpinAsync = useCallback(async () => {
    const pinned = getCachedWorkspaceState(queryClient, workspaceId)?.pinnedSessionId
    if (pinned) await mutateAsync({ sessionId: pinned, pinned: false })
  }, [mutateAsync, queryClient, workspaceId])
  const unpin = useCallback(() => void unpinAsync().catch(() => {}), [unpinAsync])
  return {
    pinnedSessionId: state?.pinnedSessionId,
    loaded: state !== undefined,
    pin,
    unpin,
    unpinAsync
  }
}
