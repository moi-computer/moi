import type { Profile, Connection, PresenceRegistration } from '@/lib/collab/types'
import { COLLAB_PROTOCOL_VERSION } from '@/lib/collab/protocol'
import type { CollabEngineApi } from '../presence/client'
import { normalizeProfile } from '../host-state'
import { CollabStore } from '../presence/store'

function normalizeProfiles(profiles: readonly Profile[]): readonly Profile[] {
  if (!Array.isArray(profiles)) throw new Error('Profiles must be an array.')
  const ids = new Set<string>()
  const snapshot = profiles.map(user => {
    const normalized = normalizeProfile(user)
    if (ids.has(normalized.id)) throw new Error('Profiles must have unique ids.')
    ids.add(normalized.id)
    return normalized
  })
  return Object.freeze(snapshot)
}

export type FakeEngineOptions = {
  self: Profile | undefined
  page?: string
  otherConnections?: Connection[]
  // Full fixture directory, including offline members.
  profiles?: readonly Profile[]
}
export type FakeEngine = CollabEngineApi & {
  setOtherConnections: (otherConnections: Connection[]) => void
  setProfiles: (profiles: readonly Profile[] | undefined) => void
}

export function createFakeEngine({
  self,
  page = 'preview',
  otherConnections = [],
  profiles: initialProfiles
}: FakeEngineOptions): FakeEngine {
  const store = new CollabStore()
  const presence = new Map<string, PresenceRegistration>()
  const userListeners = new Set<() => void>()
  let directory = initialProfiles === undefined ? undefined : normalizeProfiles(initialProfiles)
  let profiles = directory ?? (self ? [self] : [])
  let currentOtherConnections = otherConnections
  let location: Connection['location'] = { page, status: 'active' }
  const connections = (): Connection[] => [
    ...(self
      ? [{ connectionId: 'local', identityId: self.id, location, presence: [...presence.values()] }]
      : []),
    ...currentOtherConnections
  ]
  const liveProfiles = () => {
    const connected = new Set(connections().map(connection => connection.identityId))
    return profiles.filter(user => connected.has(user.id))
  }
  const announce = () =>
    store.receive({ type: 'connections', connections: connections(), profiles: liveProfiles() })
  store.setSender(message => {
    switch (message.type) {
      case 'location':
        location = message.location
        announce()
        break
      case 'presence:set': {
        const { type: _type, ...registration } = message
        presence.set(registration.registrationId, registration)
        announce()
        break
      }
      case 'presence:delete':
        presence.delete(message.registrationId)
        announce()
        break
      default:
        break
    }
  })
  store.setLocation(location)
  store.receive({
    type: 'welcome',
    version: COLLAB_PROTOCOL_VERSION,
    connectionId: 'local',
    connections: connections(),
    profiles: liveProfiles()
  })
  return {
    workspaceId: 'preview',
    enabled: true,
    start: () => () => {},
    getSnapshot: store.getSnapshot,
    getProfilesSnapshot: store.getProfilesSnapshot,
    getPresenceSnapshot: store.getPresenceSnapshot,
    subscribe: store.subscribe,
    getCurrentProfile: () => self,
    subscribeCurrentProfile: () => () => {},
    getDirectory: () => directory,
    subscribeDirectory: listener => {
      userListeners.add(listener)
      return () => {
        userListeners.delete(listener)
      }
    },
    getLocation: () => store.getLocation(),
    setLocation: location => store.setLocation(location),
    setPresence: registration => {
      if (self) store.setPresence(registration)
    },
    deletePresence: registrationId => {
      if (self) store.deletePresence(registrationId)
    },
    setOtherConnections: next => {
      currentOtherConnections = next
      announce()
    },
    setProfiles: next => {
      directory = next === undefined ? undefined : normalizeProfiles(next)
      if (directory) profiles = directory
      userListeners.forEach(listener => listener())
      announce()
    }
  }
}
