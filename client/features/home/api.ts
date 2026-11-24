import { useLocation } from 'wouter'
import { homePath } from '@/client/api/app-config'
import { toast } from '@/client/components/ui/toast'
import { workspaceApiBase, type RemoteWorkspaceTarget } from '@/lib/workspace-config'
import { workspaceInfoOptions } from '../workspace/api'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueries,
  useQueryClient
} from '@tanstack/react-query'

import { jsonRequest, requestJson, requestVoid } from '@/client/api/http'
import { trashedWorkspacesKey, workspaceKeys } from '@/client/api/workspace-keys'
import { BROWSER_TAB_ID } from '@/client/lib/browser-tab-id'
import type { WorkspaceSuggestion, WorkspaceEntry, WorkspacePreview } from '@/lib/types'

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: ({ signal }) => requestJson<WorkspaceEntry[]>('/api/workspaces', { signal }),
    staleTime: 5 * 60_000
  })
}

// Enrich a deduplicated list independently: local cards and healthy owners never
// wait for a slow owner. Home and sidebar share the same metadata requests.
export function useWorkspaceMetadata<T extends { remote?: RemoteWorkspaceTarget }>(
  entries: T[]
): T[] {
  const addresses = [
    ...new Set(
      entries.flatMap(entry =>
        entry.remote ? [workspaceApiBase(entry.remote.workspace_id, entry.remote.user_id)] : []
      )
    )
  ]
  const queries = useQueries({ queries: addresses.map(workspaceInfoOptions) })
  const byAddress = new Map(addresses.map((address, i) => [address, queries[i]?.data]))
  return entries.map(entry => {
    const info =
      entry.remote &&
      byAddress.get(workspaceApiBase(entry.remote.workspace_id, entry.remote.user_id))
    if (!info || info.isRemote) return entry
    return {
      ...entry,
      ...(info.name && { name: info.name }),
      icon: info.icon,
      theme: info.theme
    }
  })
}

const workspacePreviewsOptions = queryOptions({
  queryKey: workspaceKeys.previews,
  queryFn: () => requestJson<Record<string, WorkspacePreview>>('/api/workspaces/previews'),
  staleTime: 60_000
})

// Every card's preview in one request. The home page starts it beside the
// workspace list so it doesn't wait for the cards to mount.
export function useWorkspacePreviews() {
  return useQuery(workspacePreviewsOptions)
}

export function useWorkspacePreview(workspaceId: string) {
  return useQuery({ ...workspacePreviewsOptions, select: previews => previews[workspaceId] })
}

export function useWorkspaceSuggestions() {
  return useQuery<WorkspaceSuggestion[]>({
    queryKey: workspaceKeys.suggestions,
    queryFn: () => requestJson('/api/workspaces/suggestions')
  })
}

const REORDER_KEY = ['workspaces-reorder']

export function useReorderWorkspaces() {
  const queryClient = useQueryClient()
  return useMutation<WorkspaceEntry[], Error, string[], { previous?: WorkspaceEntry[] }>({
    mutationKey: REORDER_KEY,
    mutationFn: ids =>
      requestJson(
        '/api/workspaces/order',
        jsonRequest('PUT', { ids, origin: BROWSER_TAB_ID }),
        'Failed to reorder spaces'
      ),
    onMutate: async ids => {
      // Exact: only pause the workspace list itself — a prefix cancel would
      // abort unrelated in-flight fetches (transcripts, widgets) that never
      // retry on their own.
      await queryClient.cancelQueries({ queryKey: workspaceKeys.all, exact: true })
      const previous = queryClient.getQueryData<WorkspaceEntry[]>(workspaceKeys.all)
      if (previous) {
        const byId = new Map(previous.map(entry => [entry.id, entry]))
        const ordered = ids
          .map(id => byId.get(id))
          .filter((entry): entry is WorkspaceEntry => Boolean(entry))
        if (ordered.length === previous.length) {
          queryClient.setQueryData(workspaceKeys.all, ordered)
        }
      }
      return { previous }
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(workspaceKeys.all, context.previous)
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all, exact: true })
    },
    onSuccess: entries => {
      // An earlier drag's response must not land over a newer optimistic order.
      if (queryClient.isMutating({ mutationKey: REORDER_KEY }) > 1) return
      queryClient.setQueryData(workspaceKeys.all, entries)
    }
  })
}

export function useDeleteWorkspace(action: 'delete' | 'leave' = 'delete') {
  const [, navigate] = useLocation()
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: workspaceId =>
      requestVoid(
        `/api/workspaces/${workspaceId}`,
        { method: 'DELETE' },
        `Failed to ${action} workspace`
      ),
    onSuccess: (_result, workspaceId) => {
      queryClient.setQueryData<WorkspaceEntry[]>(workspaceKeys.all, previous =>
        (previous ?? []).filter(workspace => workspace.id !== workspaceId)
      )
      queryClient.invalidateQueries({ queryKey: workspaceKeys.suggestions })
      if (action === 'delete') queryClient.invalidateQueries({ queryKey: trashedWorkspacesKey })
      navigate(homePath())
    },
    onError: error => {
      if (action === 'leave')
        toast.add({ title: 'Couldn’t leave workspace', description: error.message, type: 'error' })
    }
  })
}

export function useTrashedWorkspaces(enabled: boolean) {
  return useQuery<WorkspaceEntry[]>({
    queryKey: trashedWorkspacesKey,
    enabled,
    queryFn: () => requestJson('/api/workspaces/trash'),
    staleTime: 60_000
  })
}

export function useRestoreWorkspace() {
  const queryClient = useQueryClient()
  return useMutation<WorkspaceEntry, Error, string>({
    mutationFn: workspaceId =>
      requestJson(
        `/api/workspaces/trash/${encodeURIComponent(workspaceId)}/restore`,
        { method: 'POST' },
        'Failed to restore workspace'
      ),
    onSuccess: (_entry, workspaceId) => {
      queryClient.setQueryData<WorkspaceEntry[]>(trashedWorkspacesKey, previous =>
        (previous ?? []).filter(workspace => workspace.id !== workspaceId)
      )
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all, exact: true })
    },
    // A workspace that can no longer be restored is about to leave trash.
    onError: () => void queryClient.invalidateQueries({ queryKey: trashedWorkspacesKey })
  })
}
