import { queryClient as appQueryClient } from '@/client/api/query-client'
import { workspaceKeys } from '@/client/api/workspace-keys'
import type { QueryClient } from '@tanstack/react-query'
import type { WorkspaceLayoutResponse } from '@/lib/types'

// Non-React consumers read the same workspace info that the loader gives to context.
export function isRemoteWorkspace(localId: string, client: QueryClient = appQueryClient) {
  return (
    client.getQueryData<WorkspaceLayoutResponse>(workspaceKeys.layout(localId))?.isRemote ?? false
  )
}

// `workspaceId`, or `ownerId:workspaceId` for a workspace on someone else's machine.
export function getWorkspaceAddress(localId: string, client: QueryClient = appQueryClient) {
  const apiBase = client.getQueryData<WorkspaceLayoutResponse>(
    workspaceKeys.layout(localId)
  )?.apiBase
  return apiBase ? decodeURIComponent(apiBase.slice('/api/workspaces/'.length)) : localId
}

export function getWorkspaceApiBase(localId: string, client: QueryClient = appQueryClient): string {
  const workspace = client.getQueryData<WorkspaceLayoutResponse>(workspaceKeys.layout(localId))
  if (!workspace?.apiBase) throw new Error('Workspace identity is not loaded')
  return workspace.apiBase
}
