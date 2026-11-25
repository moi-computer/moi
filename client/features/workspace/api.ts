import { getWorkspaceApiBase, isRemoteWorkspace } from './remote'
import { toast } from '@/client/components/ui/toast'
import { receiveWorkspaceHarness } from './harness-transition'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonRequest, requestJson, requestVoid } from '@/client/api/http'
import { WORKSPACE_RESOURCE_OPTIONS } from '@/client/api/query-options'
import { workspaceKeys } from '@/client/api/workspace-keys'
import { BROWSER_TAB_ID } from '@/client/lib/browser-tab-id'
import { useWorkspaceEvent } from '@/client/runtime/use-client-events'
import type {
  WorkspaceEntry,
  WorkspaceHarness,
  WorkspaceLayoutResponse,
  WorkspaceInfoResponse,
  WorkspaceLayoutPatch,
  WorkspaceSkillsStatus,
  WorkspaceSkillsUpdateFailure,
  HarnessType
} from '@/lib/types'

export type { WorkspaceLayoutResponse } from '@/lib/types'

// The workspace list and loader share one info query per API address.
export function workspaceInfoOptions(apiBase: string) {
  const address = decodeURIComponent(apiBase.slice('/api/workspaces/'.length))
  return {
    queryKey: workspaceKeys.layout(address),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      requestJson<WorkspaceInfoResponse>(apiBase, { signal }),
    staleTime: 60_000,
    retry: false
  }
}

export function useWorkspaceLayout(workspaceId: string) {
  const client = useQueryClient()
  const options = workspaceInfoOptions(`/api/workspaces/${workspaceId}`)
  return useQuery<WorkspaceLayoutResponse>({
    queryKey: options.queryKey,
    queryFn: async context => {
      const local = await options.queryFn(context)
      if (context.signal.aborted) throw context.signal.reason
      if (!local.isRemote) return local
      const owner = await client.fetchQuery(workspaceInfoOptions(local.apiBase))
      if (context.signal.aborted) throw context.signal.reason
      if (owner.isRemote) throw new Error('The owner address points to another remote reference')
      // Shared content comes from the owner; the folder and agent are this visitor's.
      return {
        ...owner,
        apiBase: local.apiBase,
        isRemote: local.isRemote,
        cwd: local.cwd,
        harness: local.harness,
        agentId: local.agentId
      }
    },
    ...WORKSPACE_RESOURCE_OPTIONS,
    retry: false
  })
}

// Workspace models, capabilities, and readiness for credential overrides or gateways.
export function useWorkspaceHarness(workspaceId: string) {
  const queryClient = useQueryClient()
  useWorkspaceEvent(workspaceId, event => {
    // Env can swap credentials; the server dropped its cache — refetch.
    if (event.type === 'env:changed') {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.harness(workspaceId) })
    }
  })
  return useQuery<WorkspaceHarness>({
    queryKey: workspaceKeys.harness(workspaceId),
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<WorkspaceHarness>(
        workspaceKeys.harness(workspaceId)
      )
      const refresh = previous?.hasAuthOverrides && previous.availability.status !== 'available'
      return requestJson<WorkspaceHarness>(
        `/api/workspaces/${workspaceId}/harness${refresh ? '?refresh=true' : ''}`,
        { signal }
      )
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })
}

export function useWorkspaceSkills(workspaceId: string) {
  return useQuery<WorkspaceSkillsStatus>({
    queryKey: workspaceKeys.skills(workspaceId),
    queryFn: () => requestJson(`/api/workspaces/${workspaceId}/skills`),
    ...WORKSPACE_RESOURCE_OPTIONS
  })
}

export type WorkspaceSkillUpdateError = Error & {
  status?: WorkspaceSkillsStatus
}

async function updateWorkspaceSkills(workspaceId: string): Promise<WorkspaceSkillsStatus> {
  const response = await fetch(`/api/workspaces/${workspaceId}/skills/update`, { method: 'POST' })
  const text = await response.text()
  let body: WorkspaceSkillsStatus | WorkspaceSkillsUpdateFailure | null = null
  try {
    body = JSON.parse(text) as WorkspaceSkillsStatus | WorkspaceSkillsUpdateFailure
  } catch {}

  if (!response.ok) {
    const message = body && 'error' in body ? body.error : text
    const error = new Error(message || 'Failed to update workspace skill')
    if (body?.skills) {
      ;(error as WorkspaceSkillUpdateError).status = {
        skills: body.skills,
        updateAvailable: body.updateAvailable
      }
    }
    throw error
  }
  if (!body) throw new Error('Invalid workspace skill update response')
  return body
}

export function useUpdateWorkspaceSkills(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation<WorkspaceSkillsStatus, WorkspaceSkillUpdateError>({
    mutationFn: () => updateWorkspaceSkills(workspaceId),
    onSuccess: status => {
      queryClient.setQueryData(workspaceKeys.skills(workspaceId), status)
    },
    onError: error => {
      if (error.status) {
        queryClient.setQueryData(workspaceKeys.skills(workspaceId), error.status)
      }
    }
  })
}

export function useSaveLayout(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, WorkspaceLayoutPatch>({
    mutationFn: layout =>
      requestVoid(
        getWorkspaceApiBase(workspaceId, queryClient),
        jsonRequest('PUT', { ...layout, origin: BROWSER_TAB_ID })
      ),
    onError: error => {
      toast.add({ title: 'Couldn’t save workspace', description: error.message, type: 'error' })
      if (isRemoteWorkspace(workspaceId, queryClient))
        void queryClient.invalidateQueries({
          queryKey: workspaceInfoOptions(getWorkspaceApiBase(workspaceId, queryClient)).queryKey,
          refetchType: 'none'
        })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.layout(workspaceId) })
    },
    onSuccess: () => {
      if (isRemoteWorkspace(workspaceId, queryClient))
        void queryClient.invalidateQueries({
          queryKey: workspaceInfoOptions(getWorkspaceApiBase(workspaceId, queryClient)).queryKey
        })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.layout(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all, exact: true })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.previews })
    }
  })
}

export function useChangeWorkspaceHarness(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (harness: HarnessType) =>
      requestJson<WorkspaceEntry>(
        `/api/workspaces/${workspaceId}/harness`,
        jsonRequest('PATCH', { harness })
      ),
    onSuccess: entry => {
      void receiveWorkspaceHarness(queryClient, workspaceId, entry.harness ?? 'claude-code')
    }
  })
}
