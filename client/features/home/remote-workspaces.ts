import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppConfig } from '@/client/api/app-config'
import { remoteWorkspacesKey } from '@/client/api/workspace-keys'
import { cloudRequest } from '@/client/features/account/api'
import { workspaceDisplayName } from '@/client/features/workspace/workspace-presentation'
import { workspaceAddress } from '@/lib/workspace-config'
import type { WorkspaceEntry } from '@/lib/types'

export type RemoteWorkspace = {
  id: string
  owner: { id: string; name: string }
  name?: string
  icon?: WorkspaceEntry['icon']
  theme?: WorkspaceEntry['theme']
}

export function useRemoteWorkspaces() {
  const cloud = useAppConfig().environment === 'cloud'
  return useQuery({
    queryKey: remoteWorkspacesKey,
    enabled: cloud,
    queryFn: async () => {
      const { workspaces } = (await (await cloudRequest('/api/workspaces/remote')).json()) as {
        workspaces: RemoteWorkspace[]
      }
      return workspaces
    },
    staleTime: 60_000,
    // Access can end while the page is open: the owner deletes the workspace
    // or removes the member. Check as often as Cloud rechecks live connections.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false
  })
}

const remoteAddress = (workspace: RemoteWorkspace) =>
  workspaceAddress(workspace.id, workspace.owner.id)

// The one visibility rule: a reference to someone else's workspace is shown
// while Cloud confirms the workspace. `remoteWorkspaces` is undefined until Cloud has
// answered, and a failed request leaves it undefined: neither is evidence that
// access ended, so every registered workspace stays visible.
export function visibleWorkspaces<T extends Pick<WorkspaceEntry, 'remote'>>(
  entries: T[],
  remoteWorkspaces: RemoteWorkspace[] | undefined
): T[] {
  if (!remoteWorkspaces) return entries
  const addresses = new Set(remoteWorkspaces.map(remoteAddress))
  return entries.filter(
    entry =>
      !entry.remote ||
      addresses.has(workspaceAddress(entry.remote.workspace_id, entry.remote.user_id))
  )
}

// True once Cloud, asked after this workspace was opened, no longer lists the
// workspace. An older answer may predate the invitation being accepted, so it only
// triggers a fresh request.
export function useLostRemoteAccess(address: string | undefined): boolean {
  const { data, isFetchedAfterMount, isFetching, refetch } = useRemoteWorkspaces()
  const missing =
    !!address && !!data && !data.some(workspace => remoteAddress(workspace) === address)
  // Only a successful list update can confirm access. A failed refresh also
  // counts as fetched in React Query, but keeps the last successful data.
  const updates = useQueryClient().getQueryState(remoteWorkspacesKey)?.dataUpdateCount ?? 0
  const [updatesAtOpen] = useState(updates)
  useEffect(() => {
    if (missing && !isFetchedAfterMount && !isFetching) void refetch()
  }, [missing, isFetchedAfterMount, isFetching, refetch])
  return missing && updates > updatesAtOpen
}

export type HomeWorkspace = Pick<WorkspaceEntry, 'id' | 'icon' | 'theme' | 'harness' | 'remote'> & {
  name: string
  href: string
  addedAt?: string
  ownerName?: string
}

export function homeWorkspaces(
  entries: WorkspaceEntry[],
  remoteWorkspaces: RemoteWorkspace[] | undefined
): HomeWorkspace[] {
  const registered = new Set(
    entries.flatMap(entry =>
      entry.remote ? [workspaceAddress(entry.remote.workspace_id, entry.remote.user_id)] : []
    )
  )
  const workspaces: HomeWorkspace[] = entries.map(entry => ({
    ...entry,
    name: workspaceDisplayName(entry),
    href: `/workspace/${entry.id}`
  }))
  const unopened: HomeWorkspace[] = []
  for (const workspace of remoteWorkspaces ?? []) {
    const address = remoteAddress(workspace)
    if (registered.has(address)) continue
    registered.add(address)
    unopened.push({
      id: address,
      name: workspace.name || workspace.id,
      icon: workspace.icon,
      theme: workspace.theme,
      remote: { user_id: workspace.owner.id, workspace_id: workspace.id },
      ownerName: workspace.owner.name,
      href: `/workspace/${address}`
    })
  }
  return [...unopened, ...workspaces]
}
