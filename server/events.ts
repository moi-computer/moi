import { isSharedWorkspaceEvent } from '@/lib/events'

export const EVENTS_TOPIC = 'events'
export const HARNESS_EVENTS_TOPIC = 'harness-events'
export const WORKSPACE_REFRESH_TOPIC = 'workspace-refresh'
export const workspaceEventsTopic = (workspaceId: string) => `workspace-events:${workspaceId}`

type EventPublisher = { publish: (topic: string, data: string) => unknown }
let publisher: EventPublisher | null = null

export function setEventServer(server: EventPublisher) {
  publisher = server
}

// Feature publishers also serve build callbacks, whose payloads are untyped.
export function publishEvent(msg: unknown) {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return
  if (isSharedWorkspaceEvent(msg)) {
    const { workspaceId, ...event } = msg as typeof msg & { workspaceId?: string }
    publisher?.publish(
      workspaceId ? workspaceEventsTopic(workspaceId) : WORKSPACE_REFRESH_TOPIC,
      JSON.stringify(event)
    )
    if (msg.type === 'workspace:updated' || msg.type === 'theme:updated') {
      publisher?.publish(EVENTS_TOPIC, JSON.stringify({ type: 'workspaces-list:updated' }))
    }
  } else {
    const harness =
      msg.type === 'harness-status:changed' ||
      msg.type === 'harness:updated' ||
      msg.type === 'workspace-harness:switched'
    publisher?.publish(harness ? HARNESS_EVENTS_TOPIC : EVENTS_TOPIC, JSON.stringify(msg))
  }
}
