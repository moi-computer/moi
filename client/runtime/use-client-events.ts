import { useEffect } from 'react'

import { useLatestRef } from '@/client/lib/use-latest-ref'

import { useAppContext } from './app-context'
import type { ClientEventHandler } from './app-events'

export type { ClientEvent, ClientEventHandler } from './app-events'

// Listen to every client event. Subscribing never opens or closes the
// socket — `AppProvider` owns that — so a route switch that briefly leaves
// nothing subscribed costs nothing. A no-op outside `AppProvider`.
export function useClientEvent(handler: ClientEventHandler) {
  const events = useAppContext()?.events
  const handlerRef = useLatestRef(handler)
  useEffect(() => events?.subscribe(event => handlerRef.current(event)), [events, handlerRef])
}

// Listen to one workspace plus app-wide events.
export function useWorkspaceScopedEvent(workspaceId: string, handler: ClientEventHandler) {
  useClientEvent(event => {
    if (
      'workspaceId' in event &&
      event.workspaceId !== undefined &&
      event.workspaceId !== workspaceId
    )
      return
    handler(event)
  })
}

// This hook owns presence for the displayed workspace, including reconnects.
// Requests received after a workspace switch never act on the new workspace.
export function useNavigationClient(
  workspaceId: string,
  navigate: (href: string) => void | Promise<void>
) {
  const events = useAppContext()?.events

  useEffect(() => {
    if (!events) return
    events.setNavigationWorkspace(workspaceId)
    const sendPresence = () => events.sendNavigationPresence()
    window.addEventListener('focus', sendPresence)
    document.addEventListener('visibilitychange', sendPresence)
    return () => {
      events.setNavigationWorkspace(undefined)
      window.removeEventListener('focus', sendPresence)
      document.removeEventListener('visibilitychange', sendPresence)
    }
  }, [events, workspaceId])

  useClientEvent(async event => {
    if (!events || event.type !== 'navigation:request' || event.workspaceId !== workspaceId) return
    try {
      if (events.navigationWorkspace !== workspaceId) {
        throw new Error('The browser switched workspaces.')
      }
      await navigate(event.href)
      events.send({ type: 'navigation:result', requestId: event.requestId, ok: true })
    } catch (error) {
      events.send({
        type: 'navigation:result',
        requestId: event.requestId,
        error: error instanceof Error ? error.message : 'Navigation failed'
      })
    }
  })
}
