import { getIdentity, subscribeIdentity } from '../identity/store'
import { agentIcon } from '@/client/lib/agent-client'
import type { Identity } from '../identity/types'
import { isProfile } from '@/lib/collab/protocol'
import { colorForId, isProfileColor } from '@/lib/collab/colors'
import type { AuthProvider, ProxyUserState, Profile } from '@/lib/collab/types'
import { createLocalUser } from './local-user'

export type ProfileInput = Omit<Profile, 'color'> & { color?: Profile['color'] }
// Who supplies the current user: local setup, an outer host, or an auth proxy.
export type CurrentProfileSource = 'local' | 'external' | AuthProvider

const PROFILE_KEY = 'moi:local-profile'
let currentProfile: Profile | undefined
let currentProfileSource: CurrentProfileSource | undefined
const listeners = new Set<() => void>()

// Normalized profiles list their fields in one order, so text equality is exact.
function sameProfile(a: Profile | undefined, b: Profile | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function normalizeProfile(value: ProfileInput): Profile {
  if (!value || typeof value.id !== 'string' || !value.id.trim())
    throw new Error('A profile needs an id.')
  if (value.name !== undefined && typeof value.name !== 'string')
    throw new Error('A profile name must be a string when provided.')
  if (value.color !== undefined && !isProfileColor(value.color))
    throw new Error('A profile color must be one of the user palette names.')
  const id = value.id.trim()
  const name = value.name?.trim()
  const normalized: Profile = {
    id,
    type: value.type,
    ...(value.ownerId !== undefined && { ownerId: value.ownerId }),
    ...(name ? { name } : {}),
    color: value.color ?? colorForId(id),
    ...(value.avatar !== undefined ? { avatar: value.avatar } : {}),
    ...(value.email !== undefined ? { email: value.email } : {})
  }
  if (!isProfile(normalized)) throw new Error('Invalid profile.')
  return Object.freeze(normalized)
}

export function identityProfile(identity: Identity): Profile {
  return normalizeProfile({
    id: identity.id,
    type: identity.type,
    ...(identity.type === 'agent' && identity.ownerId && { ownerId: identity.ownerId }),
    name: identity.name || undefined,
    avatar: identity.avatar ?? (identity.type === 'agent' ? agentIcon(identity.client) : undefined),
    email: identity.type === 'user' ? identity.email || undefined : undefined
  })
}

// This is a memoized projection of cloud identity, never a separately writable profile.
let cloudProfile: Profile | undefined
let cloudIdentity: ReturnType<typeof getIdentity>
export function getCurrentProfile(): Profile | undefined {
  const identity = getIdentity()
  if (identity === undefined) return currentProfile
  if (identity !== cloudIdentity) {
    cloudIdentity = identity
    const next =
      !identity || (identity.type === 'user' && identity.isAnonymous)
        ? undefined
        : identityProfile(identity)
    if (!sameProfile(cloudProfile, next)) cloudProfile = next
  }
  return cloudProfile
}

export function subscribeCurrentProfileStore(listener: () => void): () => void {
  let profile = getCurrentProfile()
  let source = getCurrentProfileSource()
  const notify = () => {
    const nextProfile = getCurrentProfile()
    const nextSource = getCurrentProfileSource()
    if (profile === nextProfile && source === nextSource) return
    profile = nextProfile
    source = nextSource
    listener()
  }
  listeners.add(notify)
  const unsubscribeIdentity = subscribeIdentity(notify)
  return () => {
    listeners.delete(notify)
    unsubscribeIdentity()
  }
}

export function getCurrentProfileSource(): CurrentProfileSource | undefined {
  return getIdentity() !== undefined ? 'external' : currentProfileSource
}

// An auth proxy takes precedence over local users; an outer host takes
// precedence over the proxy. A configured proxy with no user signs this tab out.
export function setProxyUserState({ provider, profile }: ProxyUserState): void {
  if (getCurrentProfileSource() === 'external') return
  if (provider === undefined) {
    if (currentProfileSource === undefined || currentProfileSource === 'local') return
    currentProfileSource = undefined
    currentProfile = undefined
  } else {
    const normalized = profile === undefined ? undefined : normalizeProfile(profile)
    if (currentProfileSource === provider && sameProfile(currentProfile, normalized)) return
    currentProfileSource = provider
    currentProfile = normalized
  }
  listeners.forEach(listener => listener())
}

function persistLocalUser(): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(currentProfile))
  } catch {
    /* Private browsing. */
  }
}

export function setLocalUser(next: Profile): void {
  // A provider may take over between rendering the local user form and handling input.
  if (getCurrentProfileSource() !== undefined && getCurrentProfileSource() !== 'local') return
  const normalized = normalizeProfile(next)
  currentProfileSource = 'local'
  currentProfile = normalized
  persistLocalUser()
  listeners.forEach(listener => listener())
}

// Called after startup config and proxy identity settle, before React mounts.
// A host that has already published keeps the viewer it chose, signed in or not.
export function initializeLocalUser(local: boolean, proxyUser: ProxyUserState | undefined): void {
  if (
    !local ||
    !proxyUser ||
    proxyUser.provider !== undefined ||
    getCurrentProfileSource() !== undefined
  )
    return
  try {
    const saved = localStorage.getItem(PROFILE_KEY)
    if (saved) {
      setLocalUser(JSON.parse(saved) as Profile)
      return
    }
  } catch {
    // Invalid or unavailable storage starts a fresh local profile.
  }
  setLocalUser(createLocalUser())
}

// Storage events update this tab without writing back and triggering another event.
export function receiveLocalProfile(event: Pick<StorageEvent, 'key' | 'newValue'>): void {
  if (event.key !== PROFILE_KEY || !event.newValue || getCurrentProfileSource() !== 'local') return
  try {
    const profile = normalizeProfile(JSON.parse(event.newValue) as Profile)
    if (sameProfile(profile, currentProfile)) return
    currentProfile = profile
    listeners.forEach(listener => listener())
  } catch {
    // Ignore corrupt values from other tabs.
  }
}

export function subscribeLocalProfileStorage(): () => void {
  window.addEventListener('storage', receiveLocalProfile)
  return () => window.removeEventListener('storage', receiveLocalProfile)
}
