import { isSharedWorkspaceEvent, type ServerEvent } from '@/lib/events'

export const EVENTS_TOPIC = 'events'
export const HARNESS_EVENTS_TOPIC = 'harness-events'
export const workspaceEventsTopic = (workspaceId: string) => `workspace-events:${workspaceId}`

type EventPublisher = { publish: (topic: string, data: string) => unknown }
let publisher: EventPublisher | null = null

export function setEventServer(server: EventPublisher) {
  publisher = server
}

export function publishEvent(msg: ServerEvent) {
  if (isSharedWorkspaceEvent(msg)) {
    const { workspaceId, ...event } = msg
    publisher?.publish(workspaceEventsTopic(workspaceId), JSON.stringify(event))
    if (msg.type === 'workspace-config:changed') {
      publisher?.publish(EVENTS_TOPIC, JSON.stringify({ type: 'workspaces-list:changed' }))
    }
  } else {
    const harness = msg.type === 'harness:changed' || msg.type === 'workspace-harness:switched'
    publisher?.publish(harness ? HARNESS_EVENTS_TOPIC : EVENTS_TOPIC, JSON.stringify(msg))
  }
}
