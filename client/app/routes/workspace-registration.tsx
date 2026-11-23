import { homePath, useAppConfig } from '@/client/api/app-config'
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { SidebarLayout } from '../shell/sidebar-layout'
import { useWorkspaces } from '@/client/features/home/api'
import type { HarnessType } from '@/lib/types'
import { AddWorkspaceDialog } from '@/client/features/workspace/add/add-workspace-dialog'
import { addSharedWorkspace, checkSharedWorkspaceAccess } from '@/client/features/workspace/add/api'
import {
  WorkspaceOpenError,
  WorkspaceLoadingState
} from '@/client/features/workspace/setup/workspace-recovery-states'
import { WorkspacePendingScreen } from '@/client/features/workspace/workspace-pending-screen'

type WorkspaceRegistrationProps = { userId: string; workspaceId: string }
export function WorkspaceRegistration({ userId, workspaceId }: WorkspaceRegistrationProps) {
  const cloud = useAppConfig().environment === 'cloud'
  const [location, navigate] = useLocation()
  const search = useSearch()
  const client = useQueryClient()
  const remote = { user_id: userId, workspace_id: workspaceId }
  const access = useQuery({
    queryKey: ['shared-workspace-access', userId, workspaceId],
    queryFn: () => checkSharedWorkspaceAccess(client, remote),
    enabled: cloud,
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0
  })
  const workspaces = useWorkspaces()
  const registration = useMutation({
    mutationFn: (harness: HarnessType) => addSharedWorkspace(client, remote, harness)
  })
  const existing = workspaces.data?.find(
    entry => entry.remote?.user_id === userId && entry.remote.workspace_id === workspaceId
  )
  const localId = registration.data?.id ?? existing?.id
  useEffect(() => {
    if (!cloud) {
      navigate(homePath(), { replace: true })
      return
    }
    if (!access.isSuccess || !localId) return
    const destination = location.replace(/^\/workspace\/[^/]+/, `/workspace/${localId}`)
    navigate(`${destination}${search ? `?${search}` : ''}`, { replace: true })
  }, [access.isSuccess, localId, navigate, cloud, location, search])

  const failed = access.isError
    ? access
    : !workspaces.data && workspaces.isError
      ? workspaces
      : undefined
  const needsAgent = cloud && access.isSuccess && workspaces.data && !localId
  return (
    <SidebarLayout>
      {needsAgent ? (
        <AddWorkspaceDialog
          workspaceName={access.data.name ?? workspaceId}
          isPending={registration.isPending}
          errorMessage={registration.error?.message}
          onSubmit={harness => registration.mutate(harness)}
          onClose={() => navigate(homePath(), { replace: true })}
        />
      ) : (
        <WorkspacePendingScreen setupRequired={!!failed}>
          {failed ? (
            <WorkspaceOpenError
              error={failed.error}
              retrying={failed.isFetching}
              onRetry={() => void failed.refetch()}
            />
          ) : (
            <div className="flex flex-1" role="status" aria-label="Opening shared workspace">
              <WorkspaceLoadingState />
            </div>
          )}
        </WorkspacePendingScreen>
      )}
    </SidebarLayout>
  )
}
