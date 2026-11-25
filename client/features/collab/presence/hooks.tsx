import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import type { JsonValue } from 'moi'
import type { Profile } from '@/lib/collab/types'
import type { PresenceValue } from 'moi/collab'

import { useAppletPresence, useCollabEngine } from './provider'
import { resolvePeers, resolveMember, memberStatus } from './member-profiles'
import type { MemberProfile, UsePeersOptions, UseWorkspaceMembersOptions } from './member-profiles'
import { createPresencePublisher } from './presence-publisher'

export type { MemberProfile, UsePeersOptions, UseWorkspaceMembersOptions } from './member-profiles'

const EMPTY_PROFILES: readonly Profile[] = []

export function useConnectionState() {
  const engine = useCollabEngine()
  return useSyncExternalStore(
    engine.subscribe,
    engine.getProfilesSnapshot,
    engine.getProfilesSnapshot
  )
}
function useProfileSource() {
  const engine = useCollabEngine()
  const state = useConnectionState()
  const self = useSyncExternalStore(
    engine.subscribeCurrentProfile,
    engine.getCurrentProfile,
    engine.getCurrentProfile
  )
  const directory = useSyncExternalStore(
    engine.subscribeDirectory,
    engine.getDirectory,
    engine.getDirectory
  )
  // Membership supplies profiles, including profiles who are currently offline.
  const profiles = directory ?? EMPTY_PROFILES
  return { state, self, profiles, engine }
}
export function useMember(id: string): MemberProfile | undefined {
  const { state, profiles } = useProfileSource()
  return useMemo(() => resolveMember({ ...state, profiles }, id), [state, profiles, id])
}
export function useMembers(ids: readonly string[]): (MemberProfile | undefined)[] {
  const { state, profiles } = useProfileSource()
  return ids.map(id => resolveMember({ ...state, profiles }, id))
}
export function useWorkspaceMembers({ status }: UseWorkspaceMembersOptions = {}): MemberProfile[] {
  const { state, profiles } = useProfileSource()
  return useMemo(
    () =>
      profiles
        .map(user => resolveMember({ ...state, profiles }, user.id)!)
        .filter(user => !status || user.status === status),
    [state, profiles, status]
  )
}
export function useMe(): MemberProfile | undefined {
  const { state, self, profiles } = useProfileSource()
  return useMemo(() => {
    if (!self) return undefined
    const ownerId =
      self.type === 'agent'
        ? (profiles.find(user => user.id === self.id)?.ownerId ?? self.ownerId)
        : undefined
    return {
      ...self,
      ...(ownerId && { ownerId }),
      status: memberStatus(state.connections, self.id)
    }
  }, [state, self, profiles])
}
export function usePeers(options: UsePeersOptions = {}): MemberProfile[] {
  const { state, self, profiles, engine } = useProfileSource()
  const { scope, status } = options
  return useMemo(
    () => resolvePeers({ ...state, profiles }, self?.id, engine.getLocation(), { scope, status }),
    [state, self, profiles, engine, scope, status]
  )
}
export const presenceChannels = {
  custom: (channel: string) => `custom:${channel}`,
  cursor: (id: string) => `cursor:${id}`,
  target: (target: string) => `field:${target}`
}
export type { PresenceValue } from 'moi/collab'

// Observation never allocates a registration or publishes a value.
export function usePresence<T extends JsonValue>(channel: string): PresenceValue<T>[] {
  return usePresenceChannel<T>(presenceChannels.custom(channel))
}
export function usePresenceChannel<T extends JsonValue>(channel: string): PresenceValue<T>[] {
  const { profiles, engine } = useProfileSource()
  const presence = useAppletPresence()
  const appletId = presence?.appletId ?? ''
  const snapshot = useCallback(
    () => engine.getPresenceSnapshot(appletId, channel),
    [engine, appletId, channel]
  )
  const entries = useSyncExternalStore(engine.subscribe, snapshot, snapshot)
  return useMemo(() => {
    if (!presence?.active) return []
    const known = new Set(profiles.map(user => user.id))
    return entries
      .filter(entry => known.has(entry.identityId))
      .map(entry => ({
        connectionId: entry.connectionId,
        identityId: entry.identityId,
        value: entry.value as T
      }))
  }, [entries, profiles, presence])
}

// Internal imperative publisher for pointer/focus events. Ownership is per mount.
export function usePresencePublisher<T extends JsonValue>(
  channel: string,
  initialValue: T,
  isPresent?: (value: T) => boolean
): (value: T) => void {
  const engine = useCollabEngine()
  const presence = useAppletPresence()
  const [registrationId] = useState(() => crypto.randomUUID())
  const valueRef = useRef(initialValue)
  const live = useRef(false)
  const appletId = presence?.appletId ?? ''
  const registration = useMemo(
    () => createPresencePublisher<T>(engine, { registrationId, appletId, channel }, isPresent),
    [engine, registrationId, appletId, channel, isPresent]
  )
  const publish = useCallback(() => {
    registration.publish(
      valueRef.current,
      presence?.active === true && document.visibilityState !== 'hidden'
    )
  }, [presence, registration])
  useLayoutEffect(() => {
    if (!presence?.active) return
    live.current = true
    publish()
    document.addEventListener('visibilitychange', publish)
    return () => {
      live.current = false
      document.removeEventListener('visibilitychange', publish)
      registration.clear()
    }
  }, [presence, publish, registration])
  return useCallback(
    (value: T) => {
      valueRef.current = value
      if (live.current) publish()
    },
    [publish]
  )
}
export function usePublishPresenceChannel<T extends JsonValue>(
  channel: string,
  value: T,
  isPresent?: (value: T) => boolean
): void {
  const publish = usePresencePublisher(channel, value, isPresent)
  useLayoutEffect(() => publish(value), [publish, value])
}
export function usePublishPresence<T extends JsonValue>(channel: string, value: T): void {
  usePublishPresenceChannel(presenceChannels.custom(channel), value)
}
