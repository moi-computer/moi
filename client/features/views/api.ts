import { viewTabId } from '@/lib/workspace-tabs'
import { useWorkspaceLayoutCtx } from '@/client/features/workspace/workspace-layout-context'
import type { SpeedMode } from '@/lib/types'
import type {
  CompiledView,
  MessageAttachment,
  PendingView,
  ViewInfo,
  WorkspaceState
} from '@/lib/types'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { jsonRequest, requestJson, requestVoid } from '@/client/api/http'
import { workspaceKeys } from '@/client/api/workspace-keys'
import {
  getCachedWorkspaceState,
  useWorkspaceState,
  useWorkspaceStateWrite
} from '@/client/features/workspace/workspace-state'
import { useClientEvent } from '@/client/runtime/use-client-events'

// Compiled views from `.moi/views/`. Build and layout events refetch the list;
// mounts within 30 s reuse it.
export function compiledViewsOptions(workspaceId: string, apiBase: string) {
  return {
    queryKey: workspaceKeys.views(workspaceId),
    queryFn: async () => (await requestJson<{ views: CompiledView[] }>(`${apiBase}/views`)).views,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true
  }
}

// Compiled views first, then the views still being built (from the workspace
// state), in creation order. A view that just compiled shows once.
export function mergeViews(
  compiled: CompiledView[] | undefined,
  pending: WorkspaceState['pendingViews'] | undefined
): ViewInfo[] | undefined {
  if (!compiled || !pending) return undefined
  const ids = new Set(compiled.map(view => view.id))
  const building = Object.entries(pending)
    .filter(([id]) => !ids.has(id))
    .map(([id, view]): PendingView => ({ id, ...view }))
  return [...compiled, ...building]
}

export function getCachedViews(
  queryClient: QueryClient,
  workspaceId: string
): ViewInfo[] | undefined {
  return mergeViews(
    queryClient.getQueryData<CompiledView[]>(workspaceKeys.views(workspaceId)),
    getCachedWorkspaceState(queryClient, workspaceId)?.pendingViews
  )
}

const selectPendingViews = (state: WorkspaceState) => state.pendingViews

export function useViews(workspaceId: string) {
  const { apiBase } = useWorkspaceLayoutCtx()
  const queryClient = useQueryClient()
  useClientEvent(event => {
    if (event.type === 'views-list:changed' && event.workspaceId === workspaceId) {
      const queryKey = workspaceKeys.views(workspaceId)
      // The event is newer than an in-flight list request. Apply it immediately
      // so the following personal-state:changed can safely remove the pending view.
      void queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData(queryKey, event.views)
    }
    if (event.type === 'view:deleted' && event.workspaceId === workspaceId) {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.views(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.sessions(workspaceId) })
    }
  })
  const compiled = useQuery(compiledViewsOptions(workspaceId, apiBase))
  const pending = useWorkspaceState(workspaceId, selectPendingViews)
  const data = useMemo(() => mergeViews(compiled.data, pending.data), [compiled.data, pending.data])
  return {
    data,
    isLoading: compiled.isLoading || pending.isLoading,
    isError: compiled.isError || pending.isError,
    isFetching: compiled.isFetching || pending.isFetching,
    refetch: () => Promise.all([compiled.refetch(), pending.refetch()])
  }
}
function useViewMutation<T, Input>(workspaceId: string, mutationFn: (input: Input) => Promise<T>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.views(workspaceId) })
  })
}
// A view still being built lives in this Moi's state, next to the chat building
// it. A compiled view lives with the workspace's owner.
function useViewBase(workspaceId: string) {
  const { apiBase } = useWorkspaceLayoutCtx()
  const queryClient = useQueryClient()
  const local = `/api/workspaces/${workspaceId}`
  return {
    local,
    forView: (viewId: string) =>
      getCachedWorkspaceState(queryClient, workspaceId)?.pendingViews[viewId] ? local : apiBase
  }
}
export function useRenameView(workspaceId: string) {
  const base = useViewBase(workspaceId)
  return useViewMutation(workspaceId, ({ viewId, title }: { viewId: string; title: string }) =>
    requestJson<ViewInfo>(
      `${base.forView(viewId)}/views/${encodeURIComponent(viewId)}`,
      jsonRequest('PATCH', { title }),
      'Couldn’t rename view'
    )
  )
}
export function useDeleteView(workspaceId: string) {
  const base = useViewBase(workspaceId)
  return useViewMutation(workspaceId, (viewId: string) =>
    requestVoid(
      `${base.forView(viewId)}/views/${encodeURIComponent(viewId)}`,
      { method: 'DELETE' },
      'Couldn’t delete view'
    )
  )
}
export function useCreateView(workspaceId: string) {
  const { local } = useViewBase(workspaceId)
  return useViewMutation(workspaceId, () =>
    requestJson<PendingView>(`${local}/views`, jsonRequest('POST'), 'Couldn’t create view')
  )
}
export function useSaveViewDraft(workspaceId: string) {
  const { local } = useViewBase(workspaceId)
  return useViewMutation(
    workspaceId,
    ({ viewId, requirements }: { viewId: string; requirements: string }) =>
      requestJson<PendingView>(
        `${local}/views/${viewId}`,
        jsonRequest('PATCH', { requirements }),
        'Couldn’t save view requirements'
      )
  )
}
export type SubmitViewInput = {
  viewId: string
  requirements: string
  sessionId: string
  optimisticId: string
  attachments?: MessageAttachment[]
  model?: string
  effort?: string
  speedMode?: SpeedMode
  stream?: boolean
}
export function useSubmitView(workspaceId: string) {
  const { local } = useViewBase(workspaceId)
  return useWorkspaceStateWrite<
    SubmitViewInput,
    {
      viewId: string
      sessionId: string
      state: WorkspaceState
    }
  >(workspaceId, {
    request: ({ viewId, ...input }) =>
      requestJson(
        `${local}/views/${viewId}/submit`,
        jsonRequest('POST', input),
        'Couldn’t start view chat'
      ),
    optimistic: (draft, { viewId, sessionId, requirements }) => {
      const tabId = viewTabId(viewId)
      if (!draft.pinnedSessionId) {
        draft.selected[tabId] = sessionId
        draft.sessions[sessionId] = { ...draft.sessions[sessionId], tabId }
      }
      const view = draft.pendingViews[viewId]
      if (view?.status === 'draft')
        Object.assign(view, {
          status: 'starting',
          requirements,
          buildSessionId: draft.pinnedSessionId ?? sessionId
        })
    },
    errorTitle: 'Couldn’t start view chat'
  })
}
export const useDiscardView = useDeleteView
