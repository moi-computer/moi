import { useMutation, useQueryClient } from '@tanstack/react-query'

import { jsonRequest, requestJson } from '@/client/api/http'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { useUiStore } from '@/client/store/ui'
import type { DiscoveredWorkspace, WorkspaceEntry, HarnessType } from '@/lib/types'

export function upsertWorkspaceEntry(
  entries: WorkspaceEntry[] | undefined,
  entry: WorkspaceEntry
): WorkspaceEntry[] {
  const current = entries ?? []
  const existing = current.findIndex(item => item.id === entry.id || item.path === entry.path)
  if (existing === -1) return [entry, ...current]
  return current.map((item, index) => (index === existing ? { ...item, ...entry } : item))
}

export function useImportWorkspace() {
  const queryClient = useQueryClient()
  return useMutation<WorkspaceEntry, Error, ImportWorkspaceInput>({
    mutationFn: input =>
      requestJson('/api/workspaces', jsonRequest('POST', input), 'Failed to add workspace'),
    onSuccess: (entry, input) => {
      // A remote reference holds no local project files to analyze.
      if (!entry.remote) useUiStore.getState().markWorkspacePendingAnalysis(entry.id)
      queryClient.setQueryData<WorkspaceEntry[]>(workspaceKeys.all, previous =>
        upsertWorkspaceEntry(previous, entry)
      )
      queryClient.setQueryData<DiscoveredWorkspace[]>(workspaceKeys.discover, previous =>
        (previous ?? []).filter(item => item.path !== input.path)
      )
    }
  })
}

export type ImportWorkspaceInput = {
  path: string
  harness: HarnessType
}

export type CreateWorkspaceInput = {
  name?: string
  harness: HarnessType
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation<WorkspaceEntry, Error, CreateWorkspaceInput>({
    mutationFn: input =>
      requestJson(
        '/api/workspaces/create',
        jsonRequest('POST', input),
        'Failed to create workspace'
      ),
    onSuccess: entry => {
      queryClient.setQueryData<WorkspaceEntry[]>(workspaceKeys.all, previous =>
        upsertWorkspaceEntry(previous, entry)
      )
    }
  })
}
