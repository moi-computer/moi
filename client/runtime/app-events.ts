import { wsUrl } from '@/client/lib/ws-url'
import type { ClientEvent } from '@/lib/events'

import { ReconnectingSocket } from './reconnecting-socket'
export type { ClientEvent } from '@/lib/events'

export type ClientEventHandler = (event: ClientEvent) => void

export type AppEventsClientOptions = {
  reconnectBaseDelayMs?: number
}

// The app's event bus, fed by the machine's `/api/events` socket. Workspace
// sockets emit into it too, so listeners see one stream. `AppProvider` opens
// the socket when the app mounts and closes it when the app unmounts.
export class AppEventsClient {
  private readonly listeners = new Set<ClientEventHandler>()
  private readonly socket: ReconnectingSocket
  private release: (() => void) | undefined
  private shownWorkspace: string | undefined
  private remoteSyncPending = false

  constructor(url?: string, options: AppEventsClientOptions = {}) {
    this.socket = new ReconnectingSocket(() => url ?? wsUrl('/api/events'), {
      baseDelayMs: options.reconnectBaseDelayMs
    })
    this.socket.subscribe({
      open: () => {
        if (this.remoteSyncPending) this.syncRemoteWorkspaces()
        this.sendNavigationPresence()
        this.emit({ type: 'app:connected' })
      },
      message: message => this.emit(message as ClientEvent)
    })
  }

  connect() {
    this.release ??= this.socket.start()
  }

  close() {
    this.release?.()
    this.release = undefined
  }

  subscribe(handler: ClientEventHandler): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  emit(event: ClientEvent) {
    for (const handler of this.listeners) handler(event)
  }

  // Cloud can notify us before React mounts or while the machine socket reconnects.
  syncRemoteWorkspaces() {
    this.remoteSyncPending = !this.socket.send({ type: 'remote-workspaces:updated' })
  }

  send(message: object) {
    this.socket.send(message)
  }

  // The workspace this tab shows, for the server's navigation relay. Sent now
  // and again on every reconnect.
  get navigationWorkspace(): string | undefined {
    return this.shownWorkspace
  }

  setNavigationWorkspace(workspaceId: string | undefined) {
    this.shownWorkspace = workspaceId
    this.sendNavigationPresence()
  }

  sendNavigationPresence() {
    this.send({
      type: 'navigation:presence',
      // The wire format uses `null` for "no workspace".
      workspaceId: this.shownWorkspace ?? null,
      focused: document.visibilityState === 'visible' && document.hasFocus()
    })
  }
}

export const appEvents = new AppEventsClient()
