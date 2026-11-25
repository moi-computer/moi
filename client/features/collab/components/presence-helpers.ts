import type { JsonValue } from 'moi'
import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import type { FocusEvent } from 'react'
import { presenceChannels, usePresenceChannel, usePresencePublisher } from '../presence/hooks'
import { presenceTarget } from '../presence/presence-target'

export const hasPresence = (value: JsonValue) => value !== false && value !== null

export const PresenceGroupContext = createContext<readonly string[]>([])

export function usePresenceTarget(id: string): string {
  return presenceTarget(...useContext(PresenceGroupContext), id)
}

export function useTargetPresence(target: string, present?: boolean) {
  const automatic = present === undefined
  const root = useRef<HTMLDivElement>(null)
  const channel = presenceChannels.target(target)
  const others = usePresenceChannel<boolean>(channel)
  const publish = usePresencePublisher<boolean>(channel, false, hasPresence)
  const ownsFocus = (element: EventTarget | null, owner: HTMLDivElement | null) =>
    owner !== null &&
    element instanceof Element &&
    element.closest('[data-presence-target]') === owner
  useLayoutEffect(() => {
    publish(present ?? ownsFocus(document.activeElement, root.current))
  }, [target, present, publish])
  const peers = new Map<string, { id: string; connectionId: string }>()
  for (const entry of others) {
    if (entry.value === true && !peers.has(entry.identityId)) {
      peers.set(entry.identityId, { id: entry.identityId, connectionId: entry.connectionId })
    }
  }
  return {
    peers: [...peers.values()],
    props: {
      ref: root,
      'data-collab-target': target,
      'data-presence-target': automatic ? target : undefined,
      onFocusCapture: automatic
        ? (event: FocusEvent<HTMLDivElement>) =>
            publish(ownsFocus(event.target, event.currentTarget))
        : undefined,
      onBlurCapture: automatic
        ? (event: FocusEvent<HTMLDivElement>) =>
            publish(ownsFocus(event.relatedTarget, event.currentTarget))
        : undefined
    }
  }
}
