import { workspaceApiBase } from '@/lib/workspace-config'
import { getCachedWorkspaceState } from '@/client/features/workspace/workspace-state'
import { useWorkspaceLayoutCtx } from '@/client/features/workspace/workspace-layout-context'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { jsonRequest, requestJson, requestVoid } from '@/client/api/http'
import { WORKSPACE_RESOURCE_OPTIONS } from '@/client/api/query-options'
import { workspaceKeys } from '@/client/api/workspace-keys'
import type { AppletKind, AppletThumbnail, AppletThumbnailBatch } from '@/lib/types'

// Freshness records only — image bytes stay server-side (`.moi/.cache`) and
// reach the UI as plain <img> URLs.
export function useAppletThumbnailRecords(workspaceId: string) {
  const { apiBase } = useWorkspaceLayoutCtx()
  return useQuery<AppletThumbnail[]>({
    queryKey: workspaceKeys.appletThumbnails(workspaceId),
    queryFn: async () =>
      (await requestJson<{ thumbnails: AppletThumbnail[] }>(`${apiBase}/applet-thumbnails`))
        .thumbnails,
    ...WORKSPACE_RESOURCE_OPTIONS
  })
}

export function useSaveAppletThumbnails(workspaceId: string) {
  const { apiBase } = useWorkspaceLayoutCtx()
  const queryClient = useQueryClient()

  return useMutation<void, Error, AppletThumbnailBatch>({
    mutationFn: input =>
      requestVoid(
        `${apiBase}/applet-thumbnails`,
        jsonRequest('PUT', input),
        'Failed to save applet thumbnails'
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.appletThumbnails(workspaceId) })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.previews })
    }
  })
}

// Pending views belong to the visitor. Compiled views and widgets belong to the owner.
export function useAppletUrl(kind: AppletKind) {
  const { workspaceId, apiBase } = useWorkspaceLayoutCtx()
  const client = useQueryClient()
  return (id: string) => {
    const pending =
      kind === 'view' && getCachedWorkspaceState(client, workspaceId)?.pendingViews[id]
    const base = pending ? workspaceApiBase(workspaceId) : apiBase
    return `${base}/${kind}s/${encodeURIComponent(id)}`
  }
}

export function useDeleteApplet(kind: AppletKind) {
  const { workspaceId } = useWorkspaceLayoutCtx()
  const client = useQueryClient()
  const url = useAppletUrl(kind)
  return useMutation({
    mutationFn: (id: string) =>
      requestVoid(url(id), { method: 'DELETE' }, `Couldn’t delete ${kind}`),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: workspaceKeys[kind === 'widget' ? 'widgets' : 'views'](workspaceId)
      })
  })
}
