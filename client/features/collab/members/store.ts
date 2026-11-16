import { memberKeys } from './keys'
import { queryClient } from '@/client/api/query-client'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { getWorkspaceAddress } from '@/client/features/workspace/remote'
import { getIdentity, getAccountGeneration } from '../../identity/store'
import type { Identity } from '../../identity/types'
import { collabIdentityId, identityKey } from '../../identity/types'
import { normalizeUserProfile } from '../host-state'
import type { UserProfile } from '@/lib/collab/types'
import { parseWorkspaceMembers, validWorkspaceAddress } from './types'
import type { WorkspaceMembers, WorkspaceMembersSnapshot } from './types'

// The cloud host publishes every member list; Moi never fetches one. Lists stay
// until replaced or cleared, including for workspaces with no mounted observer.
queryClient.setQueryDefaults(memberKeys.all, { gcTime: Infinity })

// Revisions track membership writes so older cloud snapshots cannot replace them.
let membersRevision = 0
let membersLoadedForAccountGeneration: number | undefined
const collectionListeners = new Set<() => void>()
const ownerSnapshots = new WeakMap<Identity, WorkspaceMembers>()
const NO_ACCESS: WorkspaceMembers = { members: [], invitations: [] }
queryClient.getQueryCache().subscribe(event => {
  if (event.query.queryKey[0] !== memberKeys.all[0]) return
  if (event.type === 'removed' || (event.type === 'updated' && event.action.type === 'success')) {
    membersRevision++
  }
})
export const getWorkspaceMembersRevision = () => membersRevision
const directoryCache = new WeakMap<WorkspaceMembers, readonly UserProfile[]>()

// Lists are keyed by workspace address: `workspaceId` on the account's own
// machine, `ownerId:workspaceId` for a workspace someone shared with it.
const accountKey = () => {
  const identity = getIdentity()
  return identity ? identityKey(identity) : undefined
}
const addressKey = (address: string) => memberKeys.workspace(accountKey(), address)

// No sharing record means owner-only on the account's own machine, and no
// access to someone else's. Unknown until the host has published its first snapshot.
function ownerOnlyWorkspaceMembers(): WorkspaceMembers | undefined {
  const owner = getIdentity()
  if (owner?.type !== 'user' || owner.isAnonymous) return undefined
  let snapshot = ownerSnapshots.get(owner)
  if (!snapshot) {
    snapshot = { members: [owner], invitations: [] }
    ownerSnapshots.set(owner, snapshot)
  }
  return snapshot
}
function unlistedWorkspaceMembers(address: string): WorkspaceMembers | undefined {
  if (membersLoadedForAccountGeneration !== getAccountGeneration()) return undefined
  return address.includes(':') ? NO_ACCESS : ownerOnlyWorkspaceMembers()
}
export function setWorkspaceMembers(address: string, value: WorkspaceMembers): void {
  queryClient.setQueryData(addressKey(validWorkspaceAddress(address)), parseWorkspaceMembers(value))
}
export function setAllWorkspaceMembers(value: WorkspaceMembersSnapshot[]): void {
  if (!Array.isArray(value)) throw new Error('Invalid workspace members')
  const snapshots = value.map(workspace => ({
    address: validWorkspaceAddress(workspace.id),
    data: parseWorkspaceMembers(workspace)
  }))
  const addresses = new Set(snapshots.map(workspace => workspace.address))
  if (addresses.size !== snapshots.length) throw new Error('Duplicate workspace id')
  membersLoadedForAccountGeneration = getAccountGeneration()
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: memberKeys.account(accountKey()) })) {
    if (!addresses.has(query.queryKey[2] as string)) forgetWorkspaceMembers(query.queryKey)
  }
  for (const workspace of snapshots)
    queryClient.setQueryData(addressKey(workspace.address), workspace.data)
  membersRevision++
  collectionListeners.forEach(listener => listener())
}
export function removeWorkspaceMembers(address: string) {
  forgetWorkspaceMembers(addressKey(validWorkspaceAddress(address)))
}
export function clearWorkspaceMembers() {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: memberKeys.all }))
    forgetWorkspaceMembers(query.queryKey)
}
function forgetWorkspaceMembers(queryKey: readonly unknown[]) {
  // Removing an observed query leaves its current UI snapshot intact. Publish
  // the replacement so mounted views and the presence engine update together.
  queryClient.setQueryData<WorkspaceMembers>(
    queryKey,
    unlistedWorkspaceMembers(queryKey[2] as string) ?? NO_ACCESS
  )
}

// A confirmed change shows at once; the host's next snapshot replaces it.
export function updateWorkspaceMembers(
  workspaceId: string,
  update: (current: WorkspaceMembers) => WorkspaceMembers
): void {
  const address = getWorkspaceAddress(workspaceId)
  queryClient.setQueryData<WorkspaceMembers>(addressKey(address), stored => {
    const current = stored ?? unlistedWorkspaceMembers(address)
    return current && update(current)
  })
}
// A saved profile reaches the member lists it appears in before the host's event does.
export function refreshMemberProfile(identity: Identity): void {
  const key = identityKey(identity)
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: memberKeys.account(accountKey()) })) {
    queryClient.setQueryData<WorkspaceMembers>(
      query.queryKey,
      current =>
        current && {
          ...current,
          members: current.members.map(member =>
            identityKey(member) === key
              ? { ...identity, ...(member.membershipId && { membershipId: member.membershipId }) }
              : member
          )
        }
    )
  }
}
// What the host last published for this workspace; undefined until it has published anything.
export function getWorkspaceMembers(workspaceId: string): WorkspaceMembers | undefined {
  const address = getWorkspaceAddress(workspaceId)
  return (
    queryClient.getQueryData<WorkspaceMembers>(addressKey(address)) ??
    unlistedWorkspaceMembers(address)
  )
}
export function getWorkspaceDirectory(workspaceId: string): readonly UserProfile[] | undefined {
  const data = getWorkspaceMembers(workspaceId)
  if (!data) return undefined
  let profiles = directoryCache.get(data)
  if (!profiles) {
    profiles = data.members.map(member =>
      normalizeUserProfile({
        id: collabIdentityId(member),
        name: member.name || undefined,
        avatar: member.avatar,
        email: member.type === 'user' ? member.email || undefined : undefined
      })
    )
    directoryCache.set(data, profiles)
  }
  return profiles
}
export function subscribeWorkspaceDirectory(listener: () => void) {
  collectionListeners.add(listener)
  const unsubscribe = queryClient.getQueryCache().subscribe(event => {
    const [scope, kind] = event.query.queryKey
    // Workspace info decides which address a workspace's list is published under.
    if (scope === memberKeys.all[0] || (scope === workspaceKeys.all[0] && kind === 'layout'))
      listener()
  })
  return () => {
    collectionListeners.delete(listener)
    unsubscribe()
  }
}
