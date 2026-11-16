import { replaceEqualDeep } from '@tanstack/query-core'
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

// The cloud host publishes every member list; Moi never fetches one. Lists are
// keyed by workspace address: `workspaceId` on the account's own machine,
// `ownerId:workspaceId` for a workspace someone shared with it.
type Published = {
  accountGeneration: number
  lists: Map<string, WorkspaceMembers>
  // The host has sent a full snapshot, so a missing list has a meaning.
  complete: boolean
}
let published: Published | undefined
// Lists belong to one account; a switch starts over.
function current(): Published {
  const accountGeneration = getAccountGeneration()
  if (published?.accountGeneration !== accountGeneration)
    published = { accountGeneration, lists: new Map(), complete: false }
  return published
}

// Revisions track membership writes so older cloud snapshots cannot replace them.
let membersRevision = 0
const listeners = new Set<() => void>()
function changed() {
  membersRevision++
  listeners.forEach(listener => listener())
}
export const getWorkspaceMembersRevision = () => membersRevision

const ownerSnapshots = new WeakMap<Identity, WorkspaceMembers>()
const NO_ACCESS: WorkspaceMembers = { members: [], invitations: [] }
const directoryCache = new WeakMap<WorkspaceMembers, readonly UserProfile[]>()

// No sharing record means owner-only on the account's own machine, and no
// access to someone else's. Unknown until the host has published its first snapshot.
function unlistedWorkspaceMembers(address: string): WorkspaceMembers | undefined {
  if (!current().complete) return undefined
  if (address.includes(':')) return NO_ACCESS
  const owner = getIdentity()
  if (owner?.type !== 'user' || owner.isAnonymous) return undefined
  let snapshot = ownerSnapshots.get(owner)
  if (!snapshot) {
    snapshot = { members: [owner], invitations: [] }
    ownerSnapshots.set(owner, snapshot)
  }
  return snapshot
}
// An unchanged list keeps its identity, so a repeated snapshot re-renders nothing.
function store(address: string, data: WorkspaceMembers) {
  const { lists } = current()
  lists.set(address, replaceEqualDeep(lists.get(address), data))
}
export function setWorkspaceMembers(address: string, value: WorkspaceMembers): void {
  store(validWorkspaceAddress(address), parseWorkspaceMembers(value))
  changed()
}
export function setAllWorkspaceMembers(value: WorkspaceMembersSnapshot[]): void {
  if (!Array.isArray(value)) throw new Error('Invalid workspace members')
  const snapshots = value.map(
    workspace => [validWorkspaceAddress(workspace.id), parseWorkspaceMembers(workspace)] as const
  )
  const addresses = new Set(snapshots.map(([address]) => address))
  if (addresses.size !== snapshots.length) throw new Error('Duplicate workspace id')
  const { lists } = current()
  for (const address of lists.keys()) if (!addresses.has(address)) lists.delete(address)
  for (const [address, data] of snapshots) store(address, data)
  current().complete = true
  changed()
}
export function removeWorkspaceMembers(address: string) {
  current().lists.delete(validWorkspaceAddress(address))
  changed()
}
export function clearWorkspaceMembers() {
  current().lists.clear()
  changed()
}

// A confirmed change shows at once; the host's next snapshot replaces it.
export function updateWorkspaceMembers(
  workspaceId: string,
  update: (current: WorkspaceMembers) => WorkspaceMembers | undefined
): void {
  const address = getWorkspaceAddress(workspaceId)
  const before = current().lists.get(address) ?? unlistedWorkspaceMembers(address)
  const after = before && update(before)
  if (!after) return
  store(address, after)
  changed()
}
// A saved profile reaches the member lists it appears in before the host's event does.
export function refreshMemberProfile(identity: Identity): void {
  const key = identityKey(identity)
  for (const [address, list] of current().lists)
    store(address, {
      ...list,
      members: list.members.map(member =>
        identityKey(member) === key
          ? { ...identity, ...(member.membershipId && { membershipId: member.membershipId }) }
          : member
      )
    })
  changed()
}
// What the host last published for this workspace; undefined until it has published anything.
export function getWorkspaceMembers(workspaceId: string): WorkspaceMembers | undefined {
  const address = getWorkspaceAddress(workspaceId)
  return current().lists.get(address) ?? unlistedWorkspaceMembers(address)
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
  listeners.add(listener)
  // Workspace info decides which address a workspace's list is published under.
  const unsubscribe = queryClient.getQueryCache().subscribe(event => {
    const [scope, kind] = event.query.queryKey
    if (scope === workspaceKeys.all[0] && kind === 'layout') listener()
  })
  return () => {
    listeners.delete(listener)
    unsubscribe()
  }
}
