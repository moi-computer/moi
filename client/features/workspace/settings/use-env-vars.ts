import { useQueryClient } from '@tanstack/react-query'

import { workspaceKeys } from '@/client/api/workspace-keys'
import { useUpdateEnv, useWorkspaceEnv } from '@/client/features/workspace/settings/api'
import { useClientEvent } from '@/client/runtime/use-client-events'

// Workspace env state in one hook: the masked env view (query), the patch
// mutation, and live tracking — anything that changes the env outside this
// client (the `moi env` CLI, another tab) makes the server broadcast
// `env:changed`, which invalidates the query so consumers stay fresh without
// wiring the subscription themselves.
export function useEnvVars(workspaceId: string) {
  const qc = useQueryClient()
  useClientEvent(e => {
    if (e.type === 'env:changed' && e.workspaceId === workspaceId) {
      qc.invalidateQueries({ queryKey: workspaceKeys.env(workspaceId) })
    }
  })
  return { env: useWorkspaceEnv(workspaceId), update: useUpdateEnv(workspaceId) }
}
