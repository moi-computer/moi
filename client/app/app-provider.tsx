import { type ReactNode, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { wsUrl } from '@/client/lib/ws-url'
import { AppContext, type AppContextValue } from '@/client/runtime/app-context'
import { WorkspaceEventsClient } from '@/client/runtime/workspace-events'

type AppProviderProps = {
  children: ReactNode
}

// App-wide events outlive workspace routes.
export function AppProvider({ children }: AppProviderProps) {
  const queryClient = useQueryClient()
  const [value] = useState<AppContextValue>(() => ({
    events: new WorkspaceEventsClient(wsUrl('/api/events'))
  }))

  useEffect(() => {
    const unsubscribe = value.events.subscribe(event => {
      if (event.type === 'connection:opened') {
        for (const queryKey of [
          ['workspaces'],
          ['workspaces', 'state'],
          ['workspaces', 'env'],
          ['app-settings']
        ])
          void queryClient.invalidateQueries({ queryKey, exact: queryKey.length === 1 })
      }
    })
    value.events.connect()
    return () => {
      unsubscribe()
      value.events.close()
    }
  }, [value, queryClient])

  return <AppContext value={value}>{children}</AppContext>
}
