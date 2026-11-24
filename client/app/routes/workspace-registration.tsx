import { homePath, useAppConfig } from '@/client/api/app-config'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { SidebarLayout } from '../shell/sidebar-layout'
import { openRemoteWorkspace } from '@/client/features/workspace/add/api'
import { WorkspaceOpenError } from '@/client/features/workspace/workspace-error-states'
import {
  WorkspaceLoadingState,
  WorkspaceFallbackScreen
} from '@/client/features/workspace/workspace-fallback-screen'

type WorkspaceRegistrationProps = { userId: string; workspaceId: string }
export function WorkspaceRegistration({ userId, workspaceId }: WorkspaceRegistrationProps) {
  const cloud = useAppConfig().environment === 'cloud'
  const [location, navigate] = useLocation()
  const search = useSearch()
  const client = useQueryClient()
  const remote = { user_id: userId, workspace_id: workspaceId }
  const opening = useQuery({
    queryKey: ['open-remote-workspace', userId, workspaceId],
    queryFn: () => openRemoteWorkspace(client, remote),
    enabled: cloud,
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0
  })
  const localId = opening.data?.id
  useEffect(() => {
    if (!cloud) {
      navigate(homePath(), { replace: true })
      return
    }
    if (!localId) return
    const destination = location.replace(/^\/workspace\/[^/]+/, `/workspace/${localId}`)
    navigate(`${destination}${search ? `?${search}` : ''}`, { replace: true })
  }, [localId, navigate, cloud, location, search])

  return (
    <SidebarLayout>
      <WorkspaceFallbackScreen showPanel={opening.isError}>
        {opening.isError ? (
          <WorkspaceOpenError
            error={opening.error}
            retrying={opening.isFetching}
            onRetry={() => void opening.refetch()}
          />
        ) : (
          <WorkspaceLoadingState aria-label="Opening shared workspace" />
        )}
      </WorkspaceFallbackScreen>
    </SidebarLayout>
  )
}
