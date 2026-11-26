import type { QueryClient } from '@tanstack/react-query'

import { appEvents } from '@/client/runtime/app-events'
import { wsUrl } from '@/client/lib/ws-url'
import { ReconnectingSocket } from '@/client/runtime/reconnecting-socket'
import { liveStore } from '@/client/features/chat/chat-store'
import { reduceChatFrame } from '@/client/features/chat/connection/chat-frames'
import type { ClientMessage } from '@/lib/types'

// App-wide chat connection: ONE WebSocket for the whole client, opened once at
// startup and never torn down on navigation. Every server frame is tagged with
// `workspaceId`, so a single socket serves every workspace and the client routes
// each frame to the right `(workspaceId, sessionId)` slice — live transcript
// deltas into the React Query cache, status/error/rename into the live store.

let qc: QueryClient | null = null
let started = false
// Messages sent while disconnected, delivered on the next open.
const queue: ClientMessage[] = []

const socket = new ReconnectingSocket(() => wsUrl('/api/harness/events'))
socket.subscribe({
  open: () => {
    for (const message of queue.splice(0)) socket.send(message)
    // Heal any deltas missed while disconnected: refetch every live transcript.
    // No-op on the first connect (nothing cached yet).
    qc?.invalidateQueries({ queryKey: ['workspaces', 'events'] })
    qc?.invalidateQueries({ queryKey: ['harness-status'] })
    qc?.invalidateQueries({ queryKey: ['workspaces', 'harness'] })
    // Any in-flight preview from before the drop is superseded by that refetch
    // (which returns the authoritative disk state) — drop them all so a frozen
    // half-streamed preview can't linger over the healed transcript.
    liveStore.getState().clearAllPreviews()
  },
  message: message => handleFrame(message as Record<string, unknown>)
})

// TTL backstop for live previews. Every clear path (turn arrival, run end,
// reconnect) is exact and should fire first; this only reaps a preview whose
// clear was somehow missed, so it can be generous.
const PREVIEW_TTL_MS = 15_000

export function initConnection(queryClient: QueryClient) {
  qc = queryClient
  if (started) return // mount/StrictMode re-invoke safety
  started = true
  setInterval(() => liveStore.getState().sweepPreviews(PREVIEW_TTL_MS, Date.now()), 5_000)
  socket.start()
}

export function handleFrame(data: Record<string, unknown>) {
  reduceChatFrame(data, { queryClient: qc })
}

export function sendMessage(msg: ClientMessage) {
  if (socket.isOpen) socket.send(msg)
  else queue.push(msg)
  if (msg.type === 'chat')
    appEvents.emit({ type: 'chat:message-sent', workspaceId: msg.workspaceId })
}

// Test seam: inject the QueryClient the frame handler reads, without opening a
// socket. Production always goes through
// `initConnection`.
export function __setQueryClientForTests(client: QueryClient | null) {
  qc = client
}
