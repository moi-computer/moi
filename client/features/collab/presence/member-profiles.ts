import type { Profile, ConnectionLocation, Connection } from '@/lib/collab/types'

import type { MemberStatus, MemberProfile, UsePeersOptions } from 'moi/collab'

export type {
  MemberStatus,
  MemberProfile,
  UsePeersOptions,
  UseWorkspaceMembersOptions
} from 'moi/collab'
export type ProfileSource = {
  connections: readonly Connection[]
  profiles: readonly Profile[]
}

export function memberStatus(connections: readonly Connection[], id: string): MemberStatus {
  const identityConnections = connections.filter(connection => connection.identityId === id)
  return identityConnections.some(connection => connection.location?.status === 'active')
    ? 'active'
    : identityConnections.length
      ? 'away'
      : 'offline'
}

export function resolveMember(source: ProfileSource, id: string): MemberProfile | undefined {
  const profile = source.profiles.find(member => member.id === id)
  return profile ? { ...profile, status: memberStatus(source.connections, id) } : undefined
}

export function resolvePeers(
  source: ProfileSource,
  selfId: string | undefined,
  location: ConnectionLocation | null,
  { scope = 'page', status }: UsePeersOptions = {}
): MemberProfile[] {
  const peers: MemberProfile[] = []
  const ids = new Set(
    source.connections
      .filter(
        connection =>
          connection.identityId !== selfId &&
          (scope === 'workspace' ||
            (location !== null && connection.location?.page === location.page))
      )
      .map(connection => connection.identityId)
  )
  for (const id of ids) {
    const member = resolveMember(source, id)
    if (member && (!status || member.status === status)) peers.push(member)
  }
  return peers
}

export type MemberPresence = {
  profile: Profile
  self: boolean
  page: string | undefined
  status: MemberStatus
}
export type CurrentProfileContext = {
  currentProfile: Profile | undefined
  page: string | null
  profiles: readonly Profile[]
}
export function summarizeMemberPresence(
  connections: Connection[],
  context: CurrentProfileContext
): MemberPresence[] {
  return context.profiles
    .map(profile => {
      const isSelf = profile.id === context.currentProfile?.id
      const activeConnection = connections.find(
        connection =>
          connection.identityId === profile.id && connection.location?.status === 'active'
      )
      return {
        profile,
        self: isSelf,
        page: isSelf ? (context.page ?? undefined) : activeConnection?.location?.page,
        status: memberStatus(connections, profile.id)
      }
    })
    .toSorted(
      (a, b) =>
        Number(b.self) - Number(a.self) ||
        Number(b.status === 'active') - Number(a.status === 'active')
    )
}
