export type SocketListener = {
  open?: () => void
  message?: (message: { type?: unknown }) => void
  close?: () => void
}

export type ReconnectingSocketOptions = {
  // Ping the server and drop a connection that has gone silent.
  ping?: boolean
  // Delay before reopening after a drop. It doubles on repeated drops, up to
  // ten seconds, and resets once a socket opens.
  baseDelayMs?: number
}

// The one WebSocket wrapper for the app, harness and workspace connections.
// It stays open while anything holds it and reopens on its own after a drop.
export class ReconnectingSocket {
  private readonly listeners = new Set<SocketListener>()
  private socket: WebSocket | undefined
  private holders = 0
  private attempts = 0
  private lastMessageAt = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined

  // The address is read on every connect.
  constructor(
    private readonly url: () => string,
    private readonly options: ReconnectingSocketOptions = {}
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  subscribe(listener: SocketListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start(): () => void {
    let held = true
    if (this.holders++ === 0) this.open()
    return () => {
      if (!held) return
      held = false
      if (--this.holders === 0) this.drop()
    }
  }

  // Replace the connection, so the server forgets what this one had joined.
  reconnect() {
    this.drop()
    if (this.holders) this.retry = setTimeout(() => this.open(), 0)
  }

  send(message: object) {
    if (!this.socket || !this.isOpen) return false
    try {
      this.socket.send(JSON.stringify(message))
      return true
    } catch {
      this.socket.close()
      return false
    }
  }

  private open() {
    if (this.socket || !this.holders) return
    const socket = new WebSocket(this.url())
    this.socket = socket
    socket.onopen = () => {
      if (socket !== this.socket) return
      this.attempts = 0
      this.lastMessageAt = Date.now()
      if (this.options.ping)
        this.heartbeat = setInterval(() => {
          if (Date.now() - this.lastMessageAt > 45_000) socket.close()
          else this.send({ type: 'ping' })
        }, 15_000)
      for (const listener of this.listeners) listener.open?.()
    }
    socket.onmessage = event => {
      if (socket !== this.socket) return
      this.lastMessageAt = Date.now()
      let message: { type?: unknown }
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      for (const listener of this.listeners) listener.message?.(message)
    }
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      if (socket !== this.socket) return
      clearInterval(this.heartbeat)
      this.socket = undefined
      for (const listener of this.listeners) listener.close?.()
      const maxDelay = Math.min((this.options.baseDelayMs ?? 500) * 2 ** this.attempts++, 10_000)
      const delay = maxDelay * (0.5 + Math.random() * 0.5)
      this.retry = setTimeout(() => this.open(), delay)
    }
  }

  private drop() {
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    const socket = this.socket
    if (!socket) return
    this.socket = undefined
    socket.close()
    for (const listener of this.listeners) listener.close?.()
  }
}
