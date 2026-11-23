import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { jsonRequest, requestJson } from '@/client/api/http'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { useUiStore } from '@/client/store/ui'
import type { DiscoveredWorkspace, WorkspaceEntry, HarnessType } from '@/lib/types'
import { workspaceApiBase, type RemoteWorkspaceTarget } from '@/lib/workspace-config'
import { workspaceInfoOptions } from '../api'

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

export async function checkSharedWorkspaceAccess(
  client: QueryClient,
  remote: RemoteWorkspaceTarget
) {
  const owner = await client.fetchQuery({
    ...workspaceInfoOptions(workspaceApiBase(remote.workspace_id, remote.user_id)),
    staleTime: 0
  })
  if (owner.isRemote) throw new Error('The owner address points to another remote reference')
  return owner
}

export async function addSharedWorkspace(
  client: QueryClient,
  remote: RemoteWorkspaceTarget,
  harness: HarnessType
) {
  const entry = await requestJson<WorkspaceEntry>(
    '/api/workspaces',
    jsonRequest('POST', { remote, harness }),
    'Failed to add workspace'
  )
  void client.invalidateQueries({ queryKey: workspaceKeys.all, exact: true })
  return entry
}
