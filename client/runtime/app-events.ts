import type { ClientEvent } from '@/lib/events'
export type { ClientEvent } from '@/lib/events'

export type ClientEventHandler = (event: ClientEvent) => void

export type AppEventsClientOptions = {
  // Delay before reopening after a drop. It doubles on repeated drops, up to
  // the max, so a downed server isn't hammered; it resets once a socket opens.
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
}

// The machine's app events socket. `AppProvider` opens it when the app
// mounts and closes it when the app unmounts; subscribers come and go freely
// in between without touching the connection. A dropped socket reopens on its
// own. Framework-free, so the connection logic is testable without React.
export class AppEventsClient {
  private readonly listeners = new Set<ClientEventHandler>()
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  // The socket being opened or open; undefined while disconnected.
  private socket: WebSocket | undefined
  private closed = true
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private shownWorkspace: string | undefined

  constructor(
    private readonly url: string,
    options: AppEventsClientOptions = {}
  ) {
    this.baseDelayMs = options.reconnectBaseDelayMs ?? 1000
    this.maxDelayMs = options.reconnectMaxDelayMs ?? 30_000
  }

  connect() {
    this.closed = false
    this.open()
  }

  // Shut the connection down for good; no reconnect follows.
  close() {
    this.closed = true
    clearTimeout(this.reconnectTimer)
    const socket = this.socket
    this.socket = undefined
    socket?.close()
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

  send(message: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(message))
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

  private open() {
    if (this.closed || this.socket) return
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.onopen = () => {
      this.reconnectAttempt = 0
      this.sendNavigationPresence()
      this.emit({ type: 'app:connected' })
    }

    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as ClientEvent
        this.emit(data)
      } catch {}
    }

    socket.onclose = () => {
      // A socket this client already let go of (closed or replaced).
      if (this.socket !== socket) return
      this.socket = undefined
      if (!this.closed) this.scheduleReconnect()
    }

    socket.onerror = () => {
      socket.close()
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(this.baseDelayMs * 2 ** this.reconnectAttempt, this.maxDelayMs)
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }
}
