export type WorkspaceSocketListener = {
  open?: () => void
  message?: (message: { type?: unknown }) => void
  close?: () => void
}

// One connection to a workspace's owner, carrying shared updates and presence.
// It stays open while anything holds it and reopens on its own after a drop.
export class WorkspaceSocket {
  private readonly listeners = new Set<WorkspaceSocketListener>()
  private socket: WebSocket | undefined
  private holders = 0
  private attempts = 0
  private lastMessageAt = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined

  // The address is read on every connect: a remote workspace resolves to its owner.
  constructor(private readonly url: () => string) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  subscribe(listener: WorkspaceSocketListener): () => void {
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
    if (!this.isOpen) return
    try {
      this.socket?.send(JSON.stringify(message))
    } catch {
      this.socket?.close()
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
      const delay = Math.min(500 * 2 ** this.attempts++, 10_000)
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
