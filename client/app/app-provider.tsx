import { type ReactNode, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useAppConfig } from '@/client/api/app-config'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { MachineResumeOverlay } from '@/client/features/machine/machine-resume-overlay'
import { BROWSER_TAB_ID } from '@/client/lib/browser-tab-id'
import { AppContext, type AppContextValue } from '@/client/runtime/app-context'
import { appEvents } from '@/client/runtime/app-events'

const appContext: AppContextValue = { events: appEvents }

type AppProviderProps = {
  children: ReactNode
}

// App-wide events outlive workspace routes.
export function AppProvider({ children }: AppProviderProps) {
  const queryClient = useQueryClient()
  const { environment } = useAppConfig()

  useEffect(() => {
    const unsubscribe = appEvents.subscribe(async event => {
      if (event.type === 'app:connected') {
        for (const queryKey of [['workspaces', 'state'], ['workspaces', 'env'], ['app-settings']])
          void queryClient.invalidateQueries({ queryKey, exact: queryKey.length === 1 })
      }
      if (
        event.type === 'app:connected' ||
        event.type === 'workspace-config:changed' ||
        (event.type === 'workspaces-list:changed' && event.origin !== BROWSER_TAB_ID)
      ) {
        const list = { queryKey: workspaceKeys.all, exact: true }
        // Invalidation alone reuses a pending first request, which can predate revocation.
        await queryClient.cancelQueries(list)
        void queryClient.invalidateQueries(list)
      }
    })
    appEvents.connect()
    return () => {
      unsubscribe()
      appEvents.close()
    }
  }, [queryClient])

  return (
    <AppContext value={appContext}>
      {children}
      {environment === 'cloud' && <MachineResumeOverlay />}
    </AppContext>
  )
}
