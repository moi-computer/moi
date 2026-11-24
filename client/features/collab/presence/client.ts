import { isSharedWorkspaceEvent } from '@/lib/events'
import { createWorkspaceSocket } from '@/client/features/workspace/remote'
import { getWorkspaceDirectory, subscribeWorkspaceDirectory } from '../members/store'
import { COLLAB_PROTOCOL_VERSION } from '@/lib/collab/protocol'
import type {
  CollabClientMessage,
  CollabServerMessage,
  UserProfile,
  ConnectionLocation,
  PresenceRegistration
} from '@/lib/collab/types'

import { getCurrentUser, subscribeCurrentUserStore, getCurrentUserSource } from '../host-state'
import { CollabStore, DISCONNECTED_STATE } from './store'
import type { ClientState, PresenceEntry } from './store'

type Unsubscribe = () => void

// A workspace exposes one engine to React. The playground implements this same
// contract; sockets, timers, and registration storage stay behind it.
export type CollabEngineApi = {
  readonly workspaceId: string
  readonly enabled: boolean
  start: () => Unsubscribe
  getSnapshot: () => ClientState
  getUsersSnapshot: () => ClientState
  getPresenceSnapshot: (appletId: string, channel: string) => readonly PresenceEntry[]
  subscribe: (listener: () => void) => Unsubscribe
  getCurrentUser: () => UserProfile | undefined
  subscribeCurrentUser: (listener: () => void) => Unsubscribe
  // Authoritative members of this workspace; never an app-wide directory.
  getDirectory: () => readonly UserProfile[] | undefined
  subscribeDirectory: (listener: () => void) => Unsubscribe
  getLocation: () => ConnectionLocation | null
  setLocation: (location: ConnectionLocation | null) => void
  setPresence: (registration: PresenceRegistration) => void
  deletePresence: (registrationId: string) => void
}

const noop = () => {}
const EMPTY_PRESENCE: readonly PresenceEntry[] = []

export const NO_ENGINE: CollabEngineApi = {
  workspaceId: '',
  enabled: false,
  start: () => noop,
  getSnapshot: () => DISCONNECTED_STATE,
  getUsersSnapshot: () => DISCONNECTED_STATE,
  getPresenceSnapshot: () => EMPTY_PRESENCE,
  subscribe: () => noop,
  getCurrentUser,
  subscribeCurrentUser: subscribeCurrentUserStore,
  getDirectory: () => undefined,
  subscribeDirectory: () => noop,
  getLocation: () => null,
  setLocation: noop,
  setPresence: noop,
  deletePresence: noop
}

// Presence for one mounted workspace with an explicit profile. It rides the
// workspace socket: holding the socket and joining is being present.
export class CollabClient implements CollabEngineApi {
  readonly store = new CollabStore()
  private release: (() => void) | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private unsubscribeSocket: (() => void) | undefined
  private unsubscribeMembers: (() => void) | undefined
  private unsubscribeCurrentUser: (() => void) | undefined
  private presenceTimer: ReturnType<typeof setTimeout> | undefined
  private queuedPresence = new Map<string, CollabClientMessage>()
  private stopped = true
  private attempts = 0
  private localDirectory: readonly UserProfile[] | undefined
  private userId = getCurrentUser()?.id

  constructor(
    readonly workspaceId: string,
    readonly enabled = true,
    private readonly socket = createWorkspaceSocket(workspaceId)
  ) {
    this.store.setSender(message => this.send(message))
  }

  getSnapshot = (): ClientState => (this.enabled ? this.store.getSnapshot() : DISCONNECTED_STATE)
  getUsersSnapshot = (): ClientState =>
    this.enabled ? this.store.getUsersSnapshot() : DISCONNECTED_STATE
  getPresenceSnapshot = (appletId: string, channel: string): readonly PresenceEntry[] =>
    this.enabled ? this.store.getPresenceSnapshot(appletId, channel) : EMPTY_PRESENCE
  subscribe = (listener: () => void): Unsubscribe =>
    this.enabled ? this.store.subscribe(listener) : noop
  getCurrentUser = getCurrentUser
  subscribeCurrentUser = subscribeCurrentUserStore
  getDirectory = () => {
    const members = getWorkspaceDirectory(this.workspaceId)
    if (members !== undefined) return members
    // Standalone Moi has one local viewer. Cloud membership never falls back.
    const local = getCurrentUserSource() !== 'external' ? getCurrentUser() : undefined
    if (!local) return undefined
    if (this.localDirectory?.[0] !== local) this.localDirectory = [local]
    return this.localDirectory
  }
  subscribeDirectory = (listener: () => void) => {
    const members = subscribeWorkspaceDirectory(listener)
    const identity = subscribeCurrentUserStore(listener)
    return () => {
      members()
      identity()
    }
  }
  getLocation = (): ConnectionLocation | null => (this.enabled ? this.store.getLocation() : null)
  setLocation = (location: ConnectionLocation | null): void => {
    this.store.setLocation(location)
  }
  setPresence = (registration: PresenceRegistration): void => {
    if (this.enabled) this.store.setPresence(registration)
  }
  deletePresence = (registrationId: string): void => {
    if (this.enabled) this.store.deletePresence(registrationId)
  }

  start(): () => void {
    if (!this.enabled) return noop
    if (!this.stopped) return () => {}
    this.stopped = false
    this.userId = getCurrentUser()?.id
    this.unsubscribeCurrentUser = subscribeCurrentUserStore(() => {
      const profile = getCurrentUser()
      if (profile?.id !== this.userId) {
        this.userId = profile?.id
        this.leave()
        this.connect()
      } else if (profile) this.send({ type: 'profile', profile })
    })
    this.unsubscribeMembers = subscribeWorkspaceDirectory(() => {
      if (this.wantsConnection()) this.connect()
      else this.leave()
    })
    this.unsubscribeSocket = this.socket.subscribe({
      open: () => this.join(),
      message: message => this.receive(message),
      close: () => this.reset()
    })
    this.connect()
    return () => this.stop()
  }

  private wantsConnection(): boolean {
    const viewer = getCurrentUser()
    return (
      !this.stopped &&
      viewer !== undefined &&
      this.getDirectory()?.some(member => member.id === viewer.id) === true
    )
  }

  private connect(): void {
    if (!this.wantsConnection()) {
      this.store.disconnect()
      return
    }
    if (this.release) return
    this.store.connecting()
    this.release = this.socket.start()
    this.join()
  }

  private join(): void {
    const profile = getCurrentUser()
    if (!this.release || !profile || !this.socket.isOpen) return
    this.socket.send({
      type: 'join',
      version: COLLAB_PROTOCOL_VERSION,
      profile,
      location: this.store.getLocation()
    })
  }

  private receive(message: { type?: unknown }): void {
    if (!this.release || isSharedWorkspaceEvent(message)) return
    const reply = message as CollabServerMessage
    if (reply.type === 'welcome') this.attempts = 0
    const rejectedJoin = reply.type === 'error' && this.store.getSnapshot().status !== 'connected'
    this.store.receive(reply)
    if (!rejectedJoin) return
    // Shared updates keep flowing on this socket; only the join is retried.
    this.store.disconnect()
    const delay = Math.min(500 * 2 ** this.attempts++, 10_000)
    this.retry = setTimeout(() => this.join(), delay)
  }

  private reset(): void {
    clearTimeout(this.retry)
    clearTimeout(this.presenceTimer)
    this.presenceTimer = undefined
    this.queuedPresence.clear()
    this.store.disconnect()
  }

  private leave(): void {
    this.reset()
    if (!this.release) return
    this.socket.reconnect()
    this.release()
    this.release = undefined
  }

  private send(message: CollabClientMessage): void {
    if (
      !getCurrentUser() &&
      (message.type === 'location' ||
        message.type === 'presence:set' ||
        message.type === 'presence:delete')
    )
      return
    if (message.type === 'presence:set') {
      this.queuedPresence.set(message.registrationId, message)
      if (!this.presenceTimer) {
        this.presenceTimer = setTimeout(() => {
          this.presenceTimer = undefined
          for (const update of this.queuedPresence.values()) this.rawSend(update)
          this.queuedPresence.clear()
        }, 50)
      }
      return
    }
    if (message.type === 'presence:delete') this.queuedPresence.delete(message.registrationId)
    this.rawSend(message)
  }

  private rawSend(message: CollabClientMessage): void {
    if (this.release) this.socket.send(message)
  }

  private stop(): void {
    this.stopped = true
    this.unsubscribeCurrentUser?.()
    this.unsubscribeMembers?.()
    this.unsubscribeSocket?.()
    this.leave()
  }
}
