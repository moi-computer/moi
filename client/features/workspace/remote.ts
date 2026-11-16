import { queryClient as appQueryClient } from '@/client/api/query-client'
import { workspaceKeys } from '@/client/api/workspace-keys'
import type { QueryClient } from '@tanstack/react-query'
import type { WorkspaceLayoutResponse } from '@/lib/types'

// Non-React consumers read the same workspace info that the loader gives to context.
const workspaceInfo = (localId: string, client: QueryClient) =>
  client.getQueryData<WorkspaceLayoutResponse>(workspaceKeys.layout(localId))

export function isRemoteWorkspace(localId: string, client: QueryClient = appQueryClient) {
  return workspaceInfo(localId, client)?.isRemote ?? false
}

export function getWorkspaceApiBase(localId: string, client: QueryClient = appQueryClient): string {
  const apiBase = workspaceInfo(localId, client)?.apiBase
  if (!apiBase) throw new Error('Workspace identity is not loaded')
  return apiBase
}

// `workspaceId`, or `ownerId:workspaceId` for a workspace on someone else's machine.
// Until the info loads, a workspace is taken to be the account's own.
export function getWorkspaceAddress(localId: string, client: QueryClient = appQueryClient) {
  const apiBase = workspaceInfo(localId, client)?.apiBase
  return apiBase ? decodeURIComponent(apiBase.slice('/api/workspaces/'.length)) : localId
}
